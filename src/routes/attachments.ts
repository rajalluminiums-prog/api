import { Hono } from 'hono';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import Attachment from '../models/Attachment';
import Work from '../models/Work';

export const attachmentsRouter = new Hono();

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

// GET /api/works/:workId/items/:itemId/attachments
attachmentsRouter.get('/:workId/items/:itemId/attachments', authMiddleware, async (c) => {
  try {
    const { workId, itemId } = c.req.param();
    const attachments = await Attachment.find({ workId, serviceItemId: itemId })
      .sort({ uploadedAt: -1 });

    return c.json({ success: true, data: attachments });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// POST /api/works/:workId/items/:itemId/attachments
attachmentsRouter.post('/:workId/items/:itemId/attachments', authMiddleware, async (c) => {
  try {
    const { workId, itemId } = c.req.param();
    const body = await c.req.parseBody();
    const file = body['image'] as File;
    const caption = body['caption'] as string | undefined;

    if (!file) {
      return c.json({ success: false, message: 'Invalid input: Missing required fields' }, 400);
    }

    const work = await Work.findById(workId);
    if (!work) {
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    if (work.status === 'draft') {
      return c.json({ success: false, message: 'Invalid input: Cannot upload attachments for draft work' }, 400);
    }

    const s3 = getS3Client();
    const bucket = process.env.AWS_S3_BUCKET_NAME;
    if (!bucket) throw new Error('S3 bucket name missing');

    const arrayBuffer = await file.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    // Smart Image Processing: limit size, convert to WebP
    const processedBuffer = await sharp(originalBuffer)
      .resize({ width: 1920, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    const s3Key = `attachments/${uuidv4()}.webp`;

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: processedBuffer,
      ContentType: 'image/webp',
    }));

    const imageUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

    const attachment = await Attachment.create({
      workId,
      serviceItemId: itemId,
      imageUrl,
      s3Key,
      caption,
    });

    return c.json({ success: true, data: attachment });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// DELETE /api/works/:workId/items/:itemId/attachments/:attachmentId
attachmentsRouter.delete('/:workId/items/:itemId/attachments/:attachmentId', authMiddleware, async (c) => {
  try {
    const { attachmentId } = c.req.param();
    
    const attachment = await Attachment.findById(attachmentId);
    if (!attachment) {
      return c.json({ success: false, message: 'Not found' }, 404);
    }

    const s3 = getS3Client();
    const bucket = process.env.AWS_S3_BUCKET_NAME;

    try {
      if (bucket && attachment.s3Key) {
        await s3.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: attachment.s3Key
        }));
      }
    } catch (s3Error) {
      console.error('Error deleting from S3:', s3Error);
    }

    await Attachment.findByIdAndDelete(attachmentId);

    return c.json({ success: true, message: 'Attachment deleted' });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});
