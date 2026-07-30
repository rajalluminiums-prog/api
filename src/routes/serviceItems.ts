import { Hono } from 'hono';
import mongoose from 'mongoose';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import Work from '../models/Work';
import ServiceItem from '../models/ServiceItem';
import Attachment from '../models/Attachment';
import { calculateItemPricing, recalculateWorkTotals } from '../utils/pricingEngine';

export const serviceItemsRouter = new Hono();

const getS3Client = () => {
  if (!process.env.AWS_REGION || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials missing');
  }
  return new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  });
};

const authMiddleware = async (c: any, next: any) => {
  const token = c.req.header('Authorization');
  if (token === 'Bearer simple-admin-token') {
    await next();
  } else {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }
};

// GET /api/works/:workId/items
serviceItemsRouter.get('/:workId/items', authMiddleware, async (c) => {
  try {
    const workId = c.req.param('workId');
    const items = await ServiceItem.find({ workId }).sort({ sortOrder: 1 }).lean();
    return c.json({ success: true, data: items });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// POST /api/works/:workId/items
serviceItemsRouter.post('/:workId/items', authMiddleware, async (c) => {
  try {
    const workId = c.req.param('workId');
    const body = await c.req.json();
    
    const work = await Work.findById(workId);
    if (!work) {
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    const { serviceCategory, configuration, sizeEntries, manualTotalPrice, description, notes, sortOrder } = body;

    const pricedSizes = await calculateItemPricing(serviceCategory, configuration || {}, sizeEntries || []);
    
    let itemCalculatedTotal = 0;
    let itemEffectiveTotal = 0;
    for (const size of pricedSizes) {
      itemCalculatedTotal += size.calculatedPrice * size.quantity;
      itemEffectiveTotal += size.lineTotal;
    }

    const finalItemTotal = manualTotalPrice !== undefined ? manualTotalPrice : itemEffectiveTotal;

    const serviceItem = new ServiceItem({
      workId,
      serviceCategory,
      configuration,
      sizeEntries: pricedSizes,
      totalCalculatedPrice: itemCalculatedTotal,
      manualTotalPrice: manualTotalPrice !== undefined ? manualTotalPrice : null,
      effectiveTotalPrice: finalItemTotal,
      description,
      notes,
      sortOrder: sortOrder || 0
    });

    await serviceItem.save();

    const items = await ServiceItem.find({ workId });
    const totals = recalculateWorkTotals({
      manualTotal: work.manualTotal,
      discountType: work.discountType,
      discountValue: work.discountValue,
      totalAdvance: work.totalAdvance
    }, items);

    work.calculatedTotal = totals.calculatedTotal;
    work.discountedTotal = totals.discountedTotal || 0;
    work.finalAmount = totals.finalAmount;
    work.remainingBalance = totals.remainingBalance;
    await work.save();

    return c.json({ success: true, data: serviceItem }, 201);
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// PUT /api/works/:workId/items/:itemId
serviceItemsRouter.put('/:workId/items/:itemId', authMiddleware, async (c) => {
  try {
    const workId = c.req.param('workId');
    const itemId = c.req.param('itemId');
    const body = await c.req.json();
    
    const work = await Work.findById(workId);
    if (!work) {
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    const serviceItem = await ServiceItem.findOne({ _id: itemId, workId });
    if (!serviceItem) {
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    const serviceCategory = body.serviceCategory !== undefined ? body.serviceCategory : serviceItem.serviceCategory;
    const configuration = body.configuration !== undefined ? body.configuration : (serviceItem.get('configuration') ? Object.fromEntries(serviceItem.get('configuration') as any) : {});
    const sizeEntries = body.sizeEntries !== undefined ? body.sizeEntries : serviceItem.sizeEntries;
    const manualTotalPrice = body.manualTotalPrice !== undefined ? body.manualTotalPrice : serviceItem.manualTotalPrice;

    const pricedSizes = await calculateItemPricing(serviceCategory, configuration, sizeEntries);
    
    let itemCalculatedTotal = 0;
    let itemEffectiveTotal = 0;
    for (const size of pricedSizes) {
      itemCalculatedTotal += size.calculatedPrice * size.quantity;
      itemEffectiveTotal += size.lineTotal;
    }

    const finalItemTotal = manualTotalPrice !== null && manualTotalPrice !== undefined ? manualTotalPrice : itemEffectiveTotal;

    serviceItem.serviceCategory = serviceCategory;
    serviceItem.configuration = configuration as any;
    serviceItem.sizeEntries = pricedSizes;
    serviceItem.totalCalculatedPrice = itemCalculatedTotal;
    serviceItem.manualTotalPrice = manualTotalPrice;
    serviceItem.effectiveTotalPrice = finalItemTotal;
    
    if (body.description !== undefined) serviceItem.description = body.description;
    if (body.notes !== undefined) serviceItem.notes = body.notes;
    if (body.sortOrder !== undefined) serviceItem.sortOrder = body.sortOrder;

    await serviceItem.save();

    const items = await ServiceItem.find({ workId });
    const totals = recalculateWorkTotals({
      manualTotal: work.manualTotal,
      discountType: work.discountType,
      discountValue: work.discountValue,
      totalAdvance: work.totalAdvance
    }, items);

    work.calculatedTotal = totals.calculatedTotal;
    work.discountedTotal = totals.discountedTotal || 0;
    work.finalAmount = totals.finalAmount;
    work.remainingBalance = totals.remainingBalance;
    await work.save();

    return c.json({ success: true, data: serviceItem });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// DELETE /api/works/:workId/items/:itemId
serviceItemsRouter.delete('/:workId/items/:itemId', authMiddleware, async (c) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const workId = c.req.param('workId');
    const itemId = c.req.param('itemId');

    const work = await Work.findById(workId).session(session);
    if (!work) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    const serviceItem = await ServiceItem.findOneAndDelete({ _id: itemId, workId }).session(session);
    if (!serviceItem) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    const attachments = await Attachment.find({ serviceItemId: itemId }).session(session);
    if (attachments.length > 0) {
      let s3;
      try {
        s3 = getS3Client();
        const bucket = process.env.AWS_S3_BUCKET_NAME;
        if (bucket) {
          for (const att of attachments) {
             if (att.s3Key) {
               await s3.send(new DeleteObjectCommand({
                 Bucket: bucket,
                 Key: att.s3Key
               }));
             }
          }
        }
      } catch (s3Error) {
        console.error('Error deleting from S3:', s3Error);
      }
      await Attachment.deleteMany({ serviceItemId: itemId }).session(session);
    }

    const items = await ServiceItem.find({ workId }).session(session);
    const totals = recalculateWorkTotals({
      manualTotal: work.manualTotal,
      discountType: work.discountType,
      discountValue: work.discountValue,
      totalAdvance: work.totalAdvance
    }, items);

    work.calculatedTotal = items.length === 0 ? 0 : totals.calculatedTotal;
    work.discountedTotal = items.length === 0 ? 0 : totals.discountedTotal || 0;
    work.finalAmount = items.length === 0 ? 0 : totals.finalAmount;
    work.remainingBalance = items.length === 0 ? 0 : totals.remainingBalance;
    await work.save({ session });

    await session.commitTransaction();
    session.endSession();

    return c.json({ success: true, message: 'Service item deleted' });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});
