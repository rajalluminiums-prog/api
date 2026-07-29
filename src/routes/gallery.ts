import { Hono } from 'hono';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import sharp from 'sharp';
import { Project } from '../models/Project';
import { Admin } from '../models/Admin';

export const galleryRouter = new Hono();

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

// Simple Auth Route
galleryRouter.post('/login', async (c) => {
  try {
    const { password } = await c.req.json();
    
    // Auto-seed if not exists (as per simple requirement)
    let admin = await Admin.findOne({ username: 'admin' });
    if (!admin) {
      admin = await Admin.create({ username: 'admin', password: '50480990' });
    }

    if (password === admin.password) {
      return c.json({ success: true, token: 'simple-admin-token' }); // Basic token for middleware
    }
    return c.json({ success: false, message: 'Invalid password' }, 401);
  } catch (error) {
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// Middleware for auth
const authMiddleware = async (c: any, next: any) => {
  const token = c.req.header('Authorization');
  if (token === 'Bearer simple-admin-token') {
    await next();
  } else {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }
};

// GET Projects (Public)
galleryRouter.get('/', async (c) => {
  try {
    const category = c.req.query('category') || 'All';
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '9');
    const skip = (page - 1) * limit;

    const query: any = { isVisible: true };
    if (category !== 'All') {
      query.category = category;
    }

    const total = await Project.countDocuments(query);
    const projects = await Project.find(query)
      .sort({ displayOrder: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return c.json({
      success: true,
      data: projects,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        current: page
      }
    });
  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

// POST Analyze Image with AI
galleryRouter.post('/analyze-image', authMiddleware, async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'] as File;
    
    if (!file) return c.json({ success: false, message: 'No file provided' }, 400);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString('base64');
    const mimeType = file.type || 'image/jpeg';
    const dataUri = `data:${mimeType};base64,${base64Image}`;

    const openai = new OpenAI({
      apiKey: process.env.NVIDIA_API_KEY,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });

    const completion = await openai.chat.completions.create({
      model: "meta/llama-3.2-90b-vision-instruct",
      messages: [
        {
          "role": "user",
          "content": [
            { 
              "type": "text", 
              "text": "You are an expert aluminium fabricator. Analyze this image and return a strictly valid JSON object. Fields: 'title' (max 40 chars, concise descriptive name), 'category' (exactly one of: Windows, Doors, Partitions, Sliders, Profiles, Custom), 'type' (max 30 chars, specific style, e.g. 'Single Door', '3-Track Slider'), 'dims' (max 25 chars, key feature. DO NOT output negative phrases like 'No glass' or 'No visible glass'. Focus ONLY on the materials you DO see, e.g. 'Aluminium Frame', 'Solid Panel'), 'altText' (max 60 chars, concise SEO description. Again, DO NOT use negative phrases). Rely ONLY on visual evidence. Do not hallucinate. Return ONLY raw JSON, no markdown formatting or backticks." 
            },
            {
              "type": "image_url",
              "image_url": { "url": dataUri }
            }
          ]
        }
      ],
      temperature: 1,
      top_p: 0.95,
      max_tokens: 1024,
      stream: false
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('AI returned no content');
    
    const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(jsonStr);

    return c.json({ success: true, data });
  } catch (error: any) {
    console.error('AI Error:', error);
    return c.json({ success: false, message: error.message }, 500);
  }
});

// POST Upload Image (Admin)
galleryRouter.post('/upload', authMiddleware, async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'] as File;
    const title = body['title'] as string;
    const category = body['category'] as string;
    const type = body['type'] as string;
    const dims = body['dims'] as string;
    const altText = body['altText'] as string;
    const gridSpan = (body['gridSpan'] as string) || 'standard';

    if (!file || !title || !category || !type || !dims || !altText) {
      return c.json({ success: false, message: 'Missing required fields' }, 400);
    }

    const s3 = getS3Client();
    const bucket = process.env.AWS_S3_BUCKET_NAME;
    if (!bucket) throw new Error('S3 bucket name missing');

    const arrayBuffer = await file.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    // Smart Image Processing: trim background, limit size, convert to WebP
    const processedBuffer = await sharp(originalBuffer)
      .trim()
      .resize({ width: 1920, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    const s3Key = `gallery/${uuidv4()}.webp`;

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: processedBuffer,
      ContentType: 'image/webp',
    }));

    const imageUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

    const project = await Project.create({
      title, category, type, dims, altText, gridSpan: gridSpan as any, s3Key, imageUrl
    });

    return c.json({ success: true, data: project });
  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

// DELETE Project (Admin)
galleryRouter.delete('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const project = await Project.findById(id);
    
    if (!project) {
      return c.json({ success: false, message: 'Project not found' }, 404);
    }

    const s3 = getS3Client();
    const bucket = process.env.AWS_S3_BUCKET_NAME;

    try {
      if (bucket && project.s3Key) {
        await s3.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: project.s3Key
        }));
      }
    } catch (s3Error) {
      console.error('Error deleting from S3:', s3Error);
    }

    await Project.findByIdAndDelete(id);

    return c.json({ success: true, message: 'Project deleted' });
  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

// PUT Update Project (Admin)
galleryRouter.put('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const contentType = c.req.header('Content-Type') || '';
    
    const existingProject = await Project.findById(id);
    if (!existingProject) {
      return c.json({ success: false, message: 'Project not found' }, 404);
    }

    let updateData: any = {};

    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody();
      
      if (body['title']) updateData.title = body['title'];
      if (body['category']) updateData.category = body['category'];
      if (body['type']) updateData.type = body['type'];
      if (body['dims']) updateData.dims = body['dims'];
      if (body['altText']) updateData.altText = body['altText'];
      if (body['gridSpan']) updateData.gridSpan = body['gridSpan'];
      
      const file = body['file'] as File;
      if (file && file.size > 0) {
        const s3 = getS3Client();
        const bucket = process.env.AWS_S3_BUCKET_NAME;
        if (!bucket) throw new Error('S3 bucket name missing');

        const arrayBuffer = await file.arrayBuffer();
        const originalBuffer = Buffer.from(arrayBuffer);

        const processedBuffer = await sharp(originalBuffer)
          .trim()
          .resize({ width: 1920, withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();

        const s3Key = `gallery/${uuidv4()}.webp`;

        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: processedBuffer,
          ContentType: 'image/webp',
        }));

        updateData.s3Key = s3Key;
        updateData.imageUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
        
        try {
          if (existingProject.s3Key) {
            await s3.send(new DeleteObjectCommand({
              Bucket: bucket,
              Key: existingProject.s3Key
            }));
          }
        } catch (s3Error) {
          console.error('Error deleting old image from S3:', s3Error);
        }
      }
    } else {
      updateData = await c.req.json();
    }
    
    const project = await Project.findByIdAndUpdate(id, updateData, { new: true });
    
    return c.json({ success: true, data: project });
  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500);
  }
});
