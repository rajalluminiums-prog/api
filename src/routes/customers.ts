import { Hono } from 'hono';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';
import Customer from '../models/Customer';
import Work from '../models/Work';
import ServiceItem from '../models/ServiceItem';
import Payment from '../models/Payment';
import Attachment from '../models/Attachment';
import DocumentModel from '../models/Document';

export const customersRouter = new Hono();

// Ensure S3 client is initialized only when needed to prevent crashes if env vars are missing during startup
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

// Middleware for auth
const authMiddleware = async (c: any, next: any) => {
  const token = c.req.header('Authorization');
  if (token === 'Bearer simple-admin-token') {
    await next();
  } else {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }
};

// GET /api/customers
customersRouter.get('/', authMiddleware, async (c) => {
  try {
    const search = c.req.query('search') || '';
    const filter = c.req.query('filter') || 'recent';
    const sort = c.req.query('sort') || 'recent';
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const skip = (page - 1) * limit;

    const matchQuery: any = {};
    if (search) {
      matchQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } }
      ];
    }

    const aggregationPipeline: any[] = [
      { $match: matchQuery },
      {
        $lookup: {
          from: 'works',
          localField: '_id',
          foreignField: 'customerId',
          as: 'works'
        }
      },
      {
        $addFields: {
          activeWorksCount: {
            $size: {
              $filter: {
                input: '$works',
                as: 'work',
                cond: { $in: ['$$work.status', ['draft', 'quotation_sent', 'waiting_advance', 'in_progress']] }
              }
            }
          },
          completedWorksCount: {
            $size: {
              $filter: {
                input: '$works',
                as: 'work',
                cond: { $in: ['$$work.status', ['completed', 'invoiced', 'archived']] }
              }
            }
          },
          inProgressWorksCount: {
            $size: {
              $filter: {
                input: '$works',
                as: 'work',
                cond: { $eq: ['$$work.status', 'in_progress'] }
              }
            }
          },
          nearDeadlineWorksCount: {
            $size: {
              $filter: {
                input: '$works',
                as: 'work',
                cond: {
                  $and: [
                    { $not: { $in: ['$$work.status', ['completed', 'invoiced', 'archived', 'cancelled']] } },
                    { $lte: ['$$work.expectedCompletionDate', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)] }
                  ]
                }
              }
            }
          },
          totalRevenue: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: '$works',
                    as: 'work',
                    cond: { $in: ['$$work.status', ['completed', 'invoiced']] }
                  }
                },
                as: 'work',
                in: '$$work.finalAmount'
              }
            }
          },
          latestWorkStatus: {
            $let: {
              vars: {
                sortedWorks: {
                  $sortArray: { input: '$works', sortBy: { createdAt: -1 } }
                }
              },
              in: { $arrayElemAt: ['$$sortedWorks.status', 0] }
            }
          }
        }
      }
    ];

    // Filtering logic
    if (filter === 'active') aggregationPipeline.push({ $match: { activeWorksCount: { $gt: 0 } } });
    if (filter === 'in_progress') aggregationPipeline.push({ $match: { inProgressWorksCount: { $gt: 0 } } });
    if (filter === 'completed') aggregationPipeline.push({ $match: { $and: [{ completedWorksCount: { $gt: 0 } }, { activeWorksCount: 0 }] } });
    if (filter === 'near_deadline') aggregationPipeline.push({ $match: { nearDeadlineWorksCount: { $gt: 0 } } });

    // Sorting logic
    let sortStage: any = { createdAt: -1 };
    if (filter === 'highest_revenue' || sort === 'revenue') {
      sortStage = { totalRevenue: -1, createdAt: -1 };
    } else if (sort === 'name') {
      sortStage = { name: 1, createdAt: -1 };
    } else if (sort === 'works_count') {
      sortStage = { completedWorksCount: -1, activeWorksCount: -1 };
    }

    aggregationPipeline.push({ $sort: sortStage });

    // Count before paginating
    const countPipeline = [...aggregationPipeline, { $count: 'total' }];
    const countResult = await Customer.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    // Paginate
    aggregationPipeline.push({ $skip: skip });
    aggregationPipeline.push({ $limit: limit });
    aggregationPipeline.push({
      $project: { works: 0, inProgressWorksCount: 0, nearDeadlineWorksCount: 0 } // exclude raw works to save bandwidth
    });

    const customers = await Customer.aggregate(aggregationPipeline);

    return c.json({
      success: true,
      data: customers,
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

// GET /api/customers/:id
customersRouter.get('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const customer = await Customer.findById(id).lean();
    
    if (!customer) {
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    const works = await Work.find({ customerId: id }).sort({ createdAt: -1 }).lean();

    const totalWorks = works.length;
    const activeWorksCount = works.filter(w => ['draft', 'quotation_sent', 'waiting_advance', 'in_progress'].includes(w.status)).length;
    const completedWorksCount = works.filter(w => ['completed', 'invoiced', 'archived'].includes(w.status)).length;
    const totalRevenue = works
      .filter(w => ['completed', 'invoiced'].includes(w.status))
      .reduce((sum, w) => sum + (w.finalAmount || 0), 0);
    const outstandingBalance = works
      .filter(w => w.status !== 'cancelled')
      .reduce((sum, w) => sum + (w.remainingBalance || 0), 0);

    const recentWorks = works.slice(0, 10).map(w => ({
      _id: w._id,
      workNumber: w.workNumber,
      title: w.title,
      status: w.status,
      createdAt: w.createdAt,
      finalAmount: w.finalAmount,
      expectedCompletionDate: w.expectedCompletionDate
    }));

    return c.json({
      success: true,
      data: {
        ...customer,
        totalWorks,
        activeWorksCount,
        completedWorksCount,
        totalRevenue,
        outstandingBalance,
        recentWorks
      }
    });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// POST /api/customers
customersRouter.post('/', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { name, mobile, email, address, notes } = body;

    if (!name || !mobile) {
      return c.json({ success: false, message: 'Invalid input: Name and mobile are required' }, 400);
    }

    const existing = await Customer.findOne({ mobile });
    if (existing) {
      return c.json({ success: false, message: 'Invalid input: Mobile number already registered' }, 400);
    }

    const customer = await Customer.create({ name, mobile, email, address, notes });

    return c.json({ success: true, data: customer }, 201);
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// PUT /api/customers/:id
customersRouter.put('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();

    const customer = await Customer.findById(id);
    if (!customer) {
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    if (body.mobile && body.mobile !== customer.mobile) {
      const existing = await Customer.findOne({ mobile: body.mobile });
      if (existing) {
        return c.json({ success: false, message: 'Invalid input: Mobile number already registered to another customer' }, 400);
      }
    }

    const updatedCustomer = await Customer.findByIdAndUpdate(id, body, { new: true });
    return c.json({ success: true, data: updatedCustomer });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// DELETE /api/customers/:id
customersRouter.delete('/:id', authMiddleware, async (c) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const id = c.req.param('id');
    const customer = await Customer.findById(id).session(session);
    
    if (!customer) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    // Cascade delete Works
    const works = await Work.find({ customerId: id }).session(session);
    const workIds = works.map(w => w._id);

    // Delete S3 Attachments
    const attachments = await Attachment.find({ workId: { $in: workIds } }).session(session);
    if (attachments.length > 0) {
      let s3;
      try {
        s3 = getS3Client();
        const bucket = process.env.AWS_S3_BUCKET_NAME;
        if (bucket) {
          // Note: In production you might want to use DeleteObjectsCommand to batch delete
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
        // Continue deletion even if S3 fails
      }
    }

    // Delete related Documents PDF from S3 as well if needed
    const documents = await DocumentModel.find({ customerId: id }).session(session);
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

    // Delete from Database
    await Attachment.deleteMany({ workId: { $in: workIds } }).session(session);
    await DocumentModel.deleteMany({ customerId: id }).session(session);
    await Payment.deleteMany({ customerId: id }).session(session);
    await ServiceItem.deleteMany({ workId: { $in: workIds } }).session(session);
    await Work.deleteMany({ customerId: id }).session(session);
    await Customer.findByIdAndDelete(id).session(session);

    await session.commitTransaction();
    session.endSession();

    return c.json({ success: true, message: 'Customer and all related records deleted' });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});
