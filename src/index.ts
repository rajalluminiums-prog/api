import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { connectDB } from './config/db';
import { reviewsRouter } from './routes/reviews';
import { ratesRouterExport } from './routes/rates';
import { galleryRouter } from './routes/gallery';
import { customersRouter } from './routes/customers';
import { dashboardRouter } from './routes/dashboard';
import { worksRouter, customerWorksRouter } from './routes/works';
import { serviceItemsRouter } from './routes/serviceItems';
import { paymentsRouter } from './routes/payments';
import { documentsRouter } from './routes/documents';
import { attachmentsRouter } from './routes/attachments';
import * as dotenv from 'dotenv';

dotenv.config();

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: '*', // For development. Adjust for production
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Routes
app.route('/api/reviews', reviewsRouter);
app.route('/api/rates', ratesRouterExport);
app.route('/api/gallery', galleryRouter);
app.route('/api/customers', customersRouter);
app.route('/api/customers', customerWorksRouter);
app.route('/api/dashboard', dashboardRouter);
app.route('/api/works', serviceItemsRouter);
app.route('/api/works', paymentsRouter);
app.route('/api/works', documentsRouter);
app.route('/api/works', attachmentsRouter);
app.route('/api/works', worksRouter);

app.get('/', (c) => c.text('API is running.'));

const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// Initialize Server
const startServer = async () => {
  await connectDB();
  
  console.log(`Server is running on port ${port}`);
  serve({
    fetch: app.fetch,
    port
  });
};

startServer();
