import { Hono } from 'hono';
import mongoose from 'mongoose';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import Work from '../models/Work';
import ServiceItem from '../models/ServiceItem';
import Payment from '../models/Payment';
import Attachment from '../models/Attachment';
import DocumentModel from '../models/Document';
import Customer from '../models/Customer';
import { Project } from '../models/Project';
import { calculateItemPricing, recalculateWorkTotals } from '../utils/pricingEngine';

export const worksRouter = new Hono();

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

// GET /api/works
worksRouter.get('/', authMiddleware, async (c) => {
  try {
    const search = c.req.query('search') || '';
    const status = c.req.query('status') || '';
    const customerId = c.req.query('customerId') || '';
    const sort = c.req.query('sort') || 'recent';
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const skip = (page - 1) * limit;

    const matchQuery: any = {};
    if (search) {
      matchQuery.$or = [
        { title: { $regex: search, $options: 'i' } },
        { workNumber: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) {
      matchQuery.status = status;
    }
    if (customerId) {
      matchQuery.customerId = new mongoose.Types.ObjectId(customerId);
    }

    let sortStage: any = { createdAt: -1 };
    if (sort === 'deadline') {
      sortStage = { expectedCompletionDate: 1, createdAt: -1 };
    } else if (sort === 'amount') {
      sortStage = { finalAmount: -1, createdAt: -1 };
    }

    const aggregationPipeline: any[] = [
      { $match: matchQuery },
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer'
        }
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $sort: sortStage }
    ];

    const countPipeline = [...aggregationPipeline, { $count: 'total' }];
    const countResult = await Work.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    aggregationPipeline.push({ $skip: skip });
    aggregationPipeline.push({ $limit: limit });

    const works = await Work.aggregate(aggregationPipeline);

    return c.json({
      success: true,
      data: works,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        current: page
      }
    });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// GET /api/customers/:customerId/works is routed slightly differently 
// wait, the prompt says GET /api/customers/:customerId/works but we are inside worksRouter mounted at /api/works.
// It's probably better to handle it here if it's GET /api/works/customer/:customerId or I can just check if I can mount it at /api/customers/:customerId/works in index.ts, or just provide it here. 
// Since worksRouter is mounted at /api/works, the path /api/customers/:customerId/works must be mounted separately or handled in customers router. But the prompt says "Create Work Routes (src/routes/works.ts) ... GET /api/customers/:customerId/works".
// Let's create it as a standalone route, but since it's in works.ts and mounted at /api/works, if I write worksRouter.get('/customer/:customerId', ...) it would be /api/works/customer/:customerId.
// I will just add an export for a router that can be mounted at /api/customers or handle it by adding a route without the prefix if possible. Wait, Hono router paths are relative to the mount point. 
// If `app.route('/api/works', worksRouter)` is used, worksRouter routes start with `/api/works`. 
// I will just add worksRouter.get('/by-customer/:customerId', ...) but the prompt specifically says "GET /api/customers/:customerId/works".
// Let's create `customerWorksRouter` in the same file and export it.
export const customerWorksRouter = new Hono();
customerWorksRouter.get('/:customerId/works', authMiddleware, async (c) => {
  try {
    const customerId = c.req.param('customerId');
    const works = await Work.find({ customerId }).sort({ createdAt: -1 }).lean();
    return c.json({ success: true, data: works });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// GET /api/works/:id
worksRouter.get('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const work = await Work.findById(id).lean();
    
    if (!work) {
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    const customer = await Customer.findById(work.customerId).lean();
    const serviceItems = await ServiceItem.find({ workId: id }).sort({ sortOrder: 1 }).lean();
    const payments = await Payment.find({ workId: id }).sort({ receivedDate: -1 }).lean();
    const documents = await DocumentModel.find({ workId: id }).sort({ createdAt: -1 }).lean();
    const attachments = await Attachment.find({ workId: id }).lean();

    return c.json({
      success: true,
      data: {
        ...work,
        customer,
        serviceItems,
        payments,
        documents,
        attachments
      }
    });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

async function generateWorkNumber() {
  const latestWork = await Work.findOne().sort({ createdAt: -1 });
  let nextNum = 1;
  if (latestWork && latestWork.workNumber) {
    const match = latestWork.workNumber.match(/WRK-(\d+)/);
    if (match) {
      nextNum = parseInt(match[1]) + 1;
    }
  }
  return `WRK-${nextNum.toString().padStart(4, '0')}`;
}

// POST /api/works
worksRouter.post('/', authMiddleware, async (c) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const body = await c.req.json();
    const { customerId, title, startDate, expectedCompletionDate, notes, serviceItems, discountType, discountValue, manualTotal, advanceAmount, advancePaymentMethod, status } = body;

    if (!customerId || !title) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Invalid input: Customer ID and title are required' }, 400);
    }

    const workNumber = await generateWorkNumber();

    const work = new Work({
      customerId,
      workNumber,
      title,
      status: status || 'draft',
      startDate,
      expectedCompletionDate,
      notes,
      discountType,
      discountValue,
      manualTotal,
      calculatedTotal: 0,
      finalAmount: 0,
      totalAdvance: 0,
      remainingBalance: 0
    });

    let calculatedTotal = 0;
    const createdItems = [];

    if (serviceItems && Array.isArray(serviceItems)) {
      for (let i = 0; i < serviceItems.length; i++) {
        const itemBody = serviceItems[i];
        
        const pricedSizes = await calculateItemPricing(itemBody.serviceCategory, itemBody.configuration || {}, itemBody.sizeEntries || []);
        
        let itemCalculatedTotal = 0;
        let itemEffectiveTotal = 0;
        for (const size of pricedSizes) {
          itemCalculatedTotal += size.calculatedPrice * size.quantity;
          itemEffectiveTotal += size.lineTotal;
        }

        const itemManualTotal = itemBody.manualTotalPrice !== undefined ? itemBody.manualTotalPrice : null;
        const finalItemTotal = itemManualTotal !== null ? itemManualTotal : itemEffectiveTotal;

        const serviceItem = new ServiceItem({
          workId: work._id,
          serviceCategory: itemBody.serviceCategory,
          configuration: itemBody.configuration,
          sizeEntries: pricedSizes,
          totalCalculatedPrice: itemCalculatedTotal,
          manualTotalPrice: itemManualTotal,
          effectiveTotalPrice: finalItemTotal,
          description: itemBody.description,
          notes: itemBody.notes,
          sortOrder: i
        });
        
        await serviceItem.save({ session });
        createdItems.push(serviceItem);
        calculatedTotal += finalItemTotal;
      }
    }

    const totals = recalculateWorkTotals({
      manualTotal,
      discountType,
      discountValue,
      totalAdvance: advanceAmount || 0
    }, createdItems);

    work.calculatedTotal = totals.calculatedTotal;
    work.discountedTotal = totals.discountedTotal || 0;
    work.finalAmount = totals.finalAmount;
    work.totalAdvance = advanceAmount || 0;
    work.remainingBalance = totals.remainingBalance;

    await work.save({ session });

    if (advanceAmount > 0) {
      const payment = new Payment({
        workId: work._id,
        customerId,
        amount: advanceAmount,
        paymentType: 'advance',
        paymentMethod: advancePaymentMethod || 'cash'
      });
      await payment.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    const fullWork = await Work.findById(work._id).lean();
    return c.json({ success: true, data: { ...fullWork, serviceItems: createdItems } }, 201);
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// PUT /api/works/:id
worksRouter.put('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { title, startDate, expectedCompletionDate, notes, discountType, discountValue, manualTotal } = body;

    const work = await Work.findById(id);
    if (!work) {
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    if (work.status === 'invoiced' || work.status === 'archived') {
      return c.json({ success: false, message: 'Invalid input: Cannot update invoiced or archived work' }, 400);
    }

    work.title = title !== undefined ? title : work.title;
    work.startDate = startDate !== undefined ? startDate : work.startDate;
    work.expectedCompletionDate = expectedCompletionDate !== undefined ? expectedCompletionDate : work.expectedCompletionDate;
    work.notes = notes !== undefined ? notes : work.notes;
    work.discountType = discountType !== undefined ? discountType : work.discountType;
    work.discountValue = discountValue !== undefined ? discountValue : work.discountValue;
    work.manualTotal = manualTotal !== undefined ? manualTotal : work.manualTotal;

    const items = await ServiceItem.find({ workId: id });
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

    return c.json({ success: true, data: work });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// PUT /api/works/:id/status
worksRouter.put('/:id/status', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const { status } = await c.req.json();

    const work = await Work.findById(id);
    if (!work) {
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    const validTransitions: Record<string, string[]> = {
      draft: ['quotation_sent', 'waiting_advance', 'in_progress', 'cancelled'],
      quotation_sent: ['waiting_advance', 'in_progress', 'cancelled'],
      waiting_advance: ['in_progress', 'cancelled'],
      in_progress: ['completed'],
      completed: ['invoiced'],
      invoiced: ['archived']
    };

    if (!validTransitions[work.status] || !validTransitions[work.status].includes(status)) {
      return c.json({ success: false, message: `Invalid input: Invalid status transition from ${work.status} to ${status}` }, 400);
    }

    if (work.status === 'waiting_advance' && status === 'in_progress') {
      if (work.totalAdvance <= 0) {
        return c.json({ success: false, message: 'Invalid input: Cannot move to in_progress without advance payment' }, 400);
      }
    }

    work.status = status;
    if (status === 'completed') {
      work.completedDate = new Date();
    }

    await work.save();

    return c.json({ success: true, data: work });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// DELETE /api/works/:id
worksRouter.delete('/:id', authMiddleware, async (c) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const id = c.req.param('id');
    const work = await Work.findById(id).session(session);
    
    if (!work) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    // Removed status restriction allowing all works to be deleted

    const attachments = await Attachment.find({ workId: id }).session(session);
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
    }

    const documents = await DocumentModel.find({ workId: id }).session(session);
    if (documents.length > 0) {
      let s3;
      try {
        s3 = getS3Client();
        const bucket = process.env.AWS_S3_BUCKET_NAME;
        if (bucket) {
          for (const doc of documents) {
             if (doc.pdfS3Key) {
               await s3.send(new DeleteObjectCommand({
                 Bucket: bucket,
                 Key: doc.pdfS3Key
               }));
             }
          }
        }
      } catch (s3Error) {
        console.error('Error deleting document PDFs from S3:', s3Error);
      }
    }

    await Attachment.deleteMany({ workId: id }).session(session);
    await DocumentModel.deleteMany({ workId: id }).session(session);
    await Payment.deleteMany({ workId: id }).session(session);
    await ServiceItem.deleteMany({ workId: id }).session(session);
    
    // Unlink Gallery Projects instead of deleting them
    await Project.updateMany(
      { linkedWorkId: id },
      { $unset: { linkedWorkId: 1, linkedServiceItemId: 1 } }
    ).session(session);

    await Work.findByIdAndDelete(id).session(session);

    await session.commitTransaction();
    session.endSession();

    return c.json({ success: true, message: 'Work and all related records deleted' });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});
