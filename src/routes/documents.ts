import { Hono } from 'hono';
import mongoose from 'mongoose';
import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import DocumentModel from '../models/Document';
import Work from '../models/Work';
import Customer from '../models/Customer';
import ServiceItem from '../models/ServiceItem';

export const documentsRouter = new Hono();

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

// GET /api/works/:workId/documents
documentsRouter.get('/:workId/documents', authMiddleware, async (c) => {
  try {
    const workId = c.req.param('workId');
    const documents = await DocumentModel.find({ workId })
      .sort({ generatedAt: -1 })
      .lean();
    return c.json({ success: true, data: documents });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// POST /api/works/:workId/documents
documentsRouter.post('/:workId/documents', authMiddleware, async (c) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const workId = c.req.param('workId');
    const body = await c.req.json();
    const { documentType } = body;
    
    if (!['quotation', 'invoice'].includes(documentType)) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Invalid input: Invalid documentType' }, 400);
    }
    
    const work = await Work.findById(workId).session(session);
    if (!work) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Not found' }, 404);
    }
    
    if (documentType === 'invoice') {
      if (!['completed', 'invoiced'].includes(work.status)) {
        await session.abortTransaction();
        session.endSession();
        return c.json({ success: false, message: 'Invalid input: Work status must be completed or invoiced to generate an invoice' }, 400);
      }
    }
    
    const customer = await Customer.findById(work.customerId).session(session);
    const serviceItems = await ServiceItem.find({ workId }).session(session);
    
    const lastDoc = await DocumentModel.findOne({ documentType })
      .sort({ createdAt: -1 })
      .session(session);
      
    let nextNumber = 1;
    if (lastDoc && lastDoc.documentNumber) {
      const match = lastDoc.documentNumber.match(/\d+$/);
      if (match) {
        nextNumber = parseInt(match[0], 10) + 1;
      }
    }
    const prefix = documentType === 'quotation' ? 'QUO-' : 'INV-';
    const documentNumber = `${prefix}${nextNumber.toString().padStart(4, '0')}`;
    
    const snapshotData = {
      work: work.toObject(),
      customer: customer ? customer.toObject() : null,
      items: serviceItems.map(item => item.toObject())
    };
    
    const doc = new DocumentModel({
      workId: work._id,
      customerId: work.customerId,
      documentType,
      documentNumber,
      snapshotData
    });
    
    await doc.save({ session });
    
    if (documentType === 'invoice' && work.status === 'completed') {
      work.status = 'invoiced';
      await work.save({ session });
    }
    
    await session.commitTransaction();
    session.endSession();
    
    return c.json({ success: true, data: doc }, 201);
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// POST /api/works/:workId/documents/:documentId/upload
documentsRouter.post('/:workId/documents/:documentId/upload', authMiddleware, async (c) => {
  try {
    const { workId, documentId } = c.req.param();
    
    const doc = await DocumentModel.findOne({ _id: documentId, workId });
    if (!doc) {
      return c.json({ success: false, message: 'Document not found' }, 404);
    }
    
    const body = await c.req.parseBody();
    const file = body['pdf'] as File;
    if (!file) {
      return c.json({ success: false, message: 'No PDF file provided' }, 400);
    }
    
    const s3Client = getS3Client();
    const bucket = process.env.AWS_S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('S3 bucket name missing');
    
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const s3Key = `documents/${workId}/${doc.documentNumber}-${uuidv4()}.pdf`;
    
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: 'application/pdf',
      ContentDisposition: `inline; filename="${doc.documentNumber}.pdf"`
    }));
    
    const pdfUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
    
    doc.pdfS3Key = s3Key;
    doc.pdfUrl = pdfUrl;
    await doc.save();
    
    return c.json({ success: true, data: doc });
  } catch (error: any) {
    console.error('Error uploading document to S3:', error);
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// DELETE /api/works/:workId/documents/:documentId
documentsRouter.delete('/:workId/documents/:documentId', authMiddleware, async (c) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { workId, documentId } = c.req.param();
    
    const doc = await DocumentModel.findOne({ _id: documentId, workId }).session(session);
    if (!doc) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Not found' }, 404);
    }
    
    if (doc.pdfS3Key) {
      try {
        const s3Client = getS3Client();
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: doc.pdfS3Key
          })
        );
      } catch (s3Error) {
        console.error('Failed to delete PDF from S3:', s3Error);
        // Continue with document deletion even if S3 delete fails
      }
    }
    
    await DocumentModel.findByIdAndDelete(documentId).session(session);
    
    await session.commitTransaction();
    session.endSession();
    
    return c.json({ success: true, message: 'Document deleted successfully' });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});
