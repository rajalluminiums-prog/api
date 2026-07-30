import { Hono } from 'hono';
import Customer from '../models/Customer';
import Work from '../models/Work';
import Payment from '../models/Payment';

export const dashboardRouter = new Hono();

// Middleware for auth
const authMiddleware = async (c: any, next: any) => {
  const token = c.req.header('Authorization');
  if (token === 'Bearer simple-admin-token') {
    await next();
  } else {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }
};

dashboardRouter.get('/stats', authMiddleware, async (c) => {
  try {
    const totalCustomers = await Customer.countDocuments({ isActive: true });
    const totalWorks = await Work.countDocuments({ status: { $in: ['quotation_sent', 'waiting_advance', 'in_progress'] } });
    
    const worksByStatusList = await Work.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const worksByStatus = {
      draft: 0,
      quotation_sent: 0,
      waiting_advance: 0,
      in_progress: 0,
      completed: 0,
      invoiced: 0,
      archived: 0,
      cancelled: 0,
    };
    worksByStatusList.forEach(w => {
      if (w._id && (worksByStatus as any)[w._id] !== undefined) {
        (worksByStatus as any)[w._id] = w.count;
      }
    });

    const revenueStats = await Payment.aggregate([
      { $group: { _id: null, totalRevenue: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenueStats.length > 0 ? revenueStats[0].totalRevenue : 0;

    const pendingStats = await Work.aggregate([
      { $match: { status: { $nin: ['archived', 'cancelled'] } } },
      { $group: { _id: null, pendingPayments: { $sum: '$remainingBalance' } } }
    ]);
    const pendingPayments = pendingStats.length > 0 ? pendingStats[0].pendingPayments : 0;

    const advancesStats = await Payment.aggregate([
      { $match: { paymentType: 'advance' } },
      { $group: { _id: null, totalAdvances: { $sum: '$amount' } } }
    ]);
    const totalAdvances = advancesStats.length > 0 ? advancesStats[0].totalAdvances : 0;

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const nextSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const weeklyRevenueStats = await Payment.aggregate([
      { $match: { receivedDate: { $gte: sevenDaysAgo } } },
      { $group: { _id: null, revenue: { $sum: '$amount' } } }
    ]);
    const weeklyRevenue = weeklyRevenueStats.length > 0 ? weeklyRevenueStats[0].revenue : 0;

    const monthlyRevenueStats = await Payment.aggregate([
      { $match: { receivedDate: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, revenue: { $sum: '$amount' } } }
    ]);
    const monthlyRevenue = monthlyRevenueStats.length > 0 ? monthlyRevenueStats[0].revenue : 0;

    const overdueWorks = await Work.countDocuments({
      status: { $nin: ['completed', 'invoiced', 'archived', 'cancelled'] },
      expectedCompletionDate: { $lt: now }
    });

    const upcomingDeadlinesList = await Work.aggregate([
      { 
        $match: {
          status: { $nin: ['completed', 'invoiced', 'archived', 'cancelled'] },
          expectedCompletionDate: { $gte: now, $lte: nextSevenDays }
        }
      },
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer'
        }
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $sort: { expectedCompletionDate: 1 } },
      { $limit: 5 }
    ]);
    const upcomingDeadlines = upcomingDeadlinesList.length;

    return c.json({
      success: true,
      data: {
        totalCustomers,
        totalWorks,
        worksByStatus,
        totalRevenue,
        pendingPayments,
        totalAdvances,
        weeklyRevenue,
        monthlyRevenue,
        overdueWorks,
        upcomingDeadlines,
        upcomingDeadlinesList
      }
    });
  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500);
  }
});
