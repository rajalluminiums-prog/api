import { Hono } from 'hono';
import mongoose from 'mongoose';
import Payment from '../models/Payment';
import Work from '../models/Work';

export const paymentsRouter = new Hono();

const authMiddleware = async (c: any, next: any) => {
  const token = c.req.header('Authorization');
  if (token === 'Bearer simple-admin-token') {
    await next();
  } else {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }
};

// GET /api/works/:workId/payments
paymentsRouter.get('/:workId/payments', authMiddleware, async (c) => {
  try {
    const workId = c.req.param('workId');
    const payments = await Payment.find({ workId })
      .sort({ receivedDate: -1 })
      .lean();
    return c.json({ success: true, data: payments });
  } catch (error: any) {
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// POST /api/works/:workId/payments
paymentsRouter.post('/:workId/payments', authMiddleware, async (c) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const workId = c.req.param('workId');
    const body = await c.req.json();
    const { amount, paymentType, paymentMethod, notes, receivedDate } = body;
    
    if (amount === undefined || amount <= 0) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Invalid input: Amount must be greater than 0' }, 400);
    }
    
    if (!['advance', 'partial', 'final'].includes(paymentType)) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Invalid input: Invalid paymentType' }, 400);
    }
    
    if (!['cash', 'upi', 'bank_transfer', 'other'].includes(paymentMethod)) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Invalid input: Invalid paymentMethod' }, 400);
    }
    
    const work = await Work.findById(workId).session(session);
    if (!work) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Not found' }, 404);
    }
    
    if (amount > work.remainingBalance) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Invalid input: Payment amount exceeds remaining balance' }, 400);
    }
    
    const payment = new Payment({
      workId: work._id,
      customerId: work.customerId,
      amount,
      paymentType,
      paymentMethod,
      notes,
      receivedDate: receivedDate ? new Date(receivedDate) : new Date()
    });
    
    await payment.save({ session });
    
    work.totalAdvance += amount;
    work.remainingBalance -= amount;
    
    if (paymentType === 'advance' && work.status === 'waiting_advance') {
      work.status = 'in_progress';
    }
    
    await work.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    return c.json({ success: true, data: payment }, 201);
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});

// DELETE /api/works/:workId/payments/:paymentId
paymentsRouter.delete('/:workId/payments/:paymentId', authMiddleware, async (c) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { workId, paymentId } = c.req.param();
    
    const payment = await Payment.findOne({ _id: paymentId, workId }).session(session);
    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Not found' }, 404);
    }
    
    const work = await Work.findById(workId).session(session);
    if (!work) {
      await session.abortTransaction();
      session.endSession();
      return c.json({ success: false, message: 'Not found' }, 404);
    }
    
    work.totalAdvance -= payment.amount;
    work.remainingBalance += payment.amount;
    
    await work.save({ session });
    
    await Payment.findByIdAndDelete(paymentId).session(session);
    
    await session.commitTransaction();
    session.endSession();
    
    return c.json({ success: true, message: 'Payment deleted successfully' });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return c.json({ success: false, message: error.message || 'Internal Server Error' }, 500);
  }
});
