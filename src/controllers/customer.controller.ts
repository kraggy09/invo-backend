import Customer from "../models/customer.model";
import { Response } from "express";
import ApiResponse from "../utils/ApiResponse";
import Bill from "../models/bill.model";
import ReturnBill from "../models/returnBill.model";
import Transaction from "../models/transaction.model";
import { EVENTS_MAP } from "../constant/redisMap";
import CustomerJourney from "../models/customerJourney.model";
import mongoose from "mongoose";
import { journeyQueue } from "../queues/journeyQueue";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import moment from "moment-timezone";
import { scopedMatch } from "../utils/scopedMatch";

const IST = "Asia/Kolkata";

export const createNewCustomer = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const customerData = req.body;
    let { name, outstanding, phone, idempotencyKey } = customerData;

    if (idempotencyKey) {
      const existingCustomer = await Customer.findOne({ shopId, idempotencyKey });
      if (existingCustomer) {
        return ApiResponse(res, 200, true, "Customer already exists (Idempotent)", {
          customer: existingCustomer,
        });
      }
    }


    if (phone.length != 10) {
      return ApiResponse(res, 400, false, "Phone number should be of 10 digit");
    }

    name = name.toLowerCase().trim();

    // Uniqueness check is SCOPED PER SHOP
    const customer = await Customer.findOne({ shopId, $or: [{ name }, { phone }] });

    if (customer) {
      return ApiResponse(res, 404, false, "Customer already exists");
    }
    const newCustomer = await Customer.create({
      shopId,
      name,
      outstanding,
      phone,
      idempotencyKey,
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.CUSTOMER_CREATED, newCustomer);
    }

    journeyQueue.add("customer-created", {
      shopId: shopId.toString(),
      journeyLog: {
        eventType: "CUSTOMER_CREATED",
        message: `Customer ${newCustomer.name} created`,
        createdBy: req.user?._id || null,
        entityType: "Customer",
        entityId: newCustomer._id,
        metadata: { phone: newCustomer.phone, outstanding: newCustomer.outstanding }
      }
    });

    return ApiResponse(res, 201, true, "Customer created successfully", {
      customer: newCustomer,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server error");
  }
};

export const getAllCustomers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const customers = await Customer.find({ shopId });

    return ApiResponse(res, 200, true, "List of customers", { customers: customers || [] });
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};

export const getSingleCustomer = async (req: AuthenticatedRequest, res: Response) => {
  const shopId = req.shopId!;
  const customerId = req.params.id;

  const user = req.user
  if (!user) {
    return ApiResponse(res, 404, false, "Unable to find the User")
  }

  const userRoles = req.shopMember?.roles || [];
  const hasJourneyLogsAccess = userRoles.some((role) => ["SUPER_ADMIN", "ADMIN", "CREATOR"].includes(role))
  try {
    // IDOR prevention: must belong to this shop
    const customer = await Customer.findOne({ _id: customerId, shopId });
    if (!customer) {
      return ApiResponse(res, 404, false, "Customer not found");
    }

    // Only fetch RECENT records for the initial load to prevent crashes
    const recentLimit = 20;

    const bills = await Bill.find({ shopId, customer: customerId })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .limit(recentLimit)
      .lean();

    const returnBills = await ReturnBill.find({ shopId, customer: customerId })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .limit(recentLimit)
      .lean();

    const transactions = await Transaction.find({
      shopId,
      customer: customerId,
      approved: true,
    })
      .sort({ createdAt: -1 })
      .limit(recentLimit)
      .lean();

    let journeys: any[] = [];
    if (hasJourneyLogsAccess) {
      journeys = await CustomerJourney.find({ shopId, customer: customerId })
        .populate("user", "name username")
        .sort({ createdAt: -1 })
        .limit(recentLimit)
        .lean();
    }

    const totalBills = await Bill.countDocuments({ shopId, customer: customerId });
    const totalReturnBills = await ReturnBill.countDocuments({ shopId, customer: customerId });
    const totalTransactions = await Transaction.countDocuments({ shopId, customer: customerId, approved: true });
    let totalJourneys = 0;
    if (hasJourneyLogsAccess) {
      totalJourneys = await CustomerJourney.countDocuments({ shopId, customer: customerId });
    }

    const newCustomer = {
      ...customer.toObject(),
      bills,
      returnBills,
      transactions,
      journeys,
      totalBills,
      totalReturnBills,
      totalTransactions,
      totalJourneys,
    };

    return ApiResponse(res, 200, true, "Customer found successfully", {
      customer: newCustomer,
    });
  } catch (error: any) {
    console.error("Error fetching customer:", error);
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

export const getCustomerAnalytics = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const customerId = req.params.id as string;
    let days = parseInt(req.query.days as string) || 7;

    // Validate days ranges
    if (![7, 15, 30, 45].includes(days)) {
      days = 7;
    }

    const endDate = moment.tz(IST).endOf("day").toDate();
    const startDate = moment.tz(IST).subtract(days - 1, "days").startOf("day").toDate();

    // 1. Fetch Bills for Sales & Profit — scoped to this shop
    const billsAgg = await Bill.aggregate([
      scopedMatch(shopId, {
        customer: new mongoose.Types.ObjectId(customerId),
        createdAt: { $gte: startDate, $lte: endDate }
      }),
      {
        $unwind: "$items"
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          dailySales: { $sum: "$items.total" },
          dailyCost: {
            $sum: {
              $multiply: [
                { $ifNull: ["$items.productSnapshot.costPrice", "$items.costPrice"] },
                "$items.quantity"
              ]
            }
          }
        }
      },
      {
        $project: {
          date: "$_id",
          sales: "$dailySales",
          profit: { $subtract: ["$dailySales", "$dailyCost"] },
          _id: 0
        }
      },
      { $sort: { date: 1 } }
    ]);

    // 2. Fetch Transactions for Payments — scoped to this shop
    const txAgg = await Transaction.aggregate([
      scopedMatch(shopId, {
        customer: new mongoose.Types.ObjectId(customerId),
        createdAt: { $gte: startDate, $lte: endDate },
        approved: true,
        $or: [
          { paymentIn: true },
          { paymentIn: { $exists: false }, taken: false } // Legacy support
        ]
      }),
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          dailyPayments: { $sum: "$amount" }
        }
      },
      {
        $project: {
          date: "$_id",
          payment: "$dailyPayments",
          _id: 0
        }
      },
      { $sort: { date: 1 } }
    ]);

    // 3. Merge data into a continuous timeline array
    const chartData = [];
    let totalSales = 0;
    let totalProfit = 0;
    let totalPayments = 0;

    // Fill the array with the requested days chronologically
    for (let i = 0; i < days; i++) {
      const d = moment.tz(startDate, IST).add(i, "days");
      const dateStr = d.format("YYYY-MM-DD");

      const billMatch = billsAgg.find(b => b.date === dateStr);
      const txMatch = txAgg.find(t => t.date === dateStr);

      const daySales = billMatch ? billMatch.sales : 0;
      const dayProfit = billMatch ? billMatch.profit : 0;
      const dayPayment = txMatch ? txMatch.payment : 0;

      totalSales += daySales;
      totalProfit += dayProfit;
      totalPayments += dayPayment;

      chartData.push({
        date: dateStr,
        sales: daySales,
        profit: dayProfit,
        payment: dayPayment
      });
    }

    return ApiResponse(res, 200, true, "Customer analytics retrieved successfully", {
      chartData,
      summary: {
        totalSales,
        totalProfit,
        totalPayments
      }
    });

  } catch (error: any) {
    console.error("Error fetching customer analytics:", error);
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

export const getCustomerHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const customerId = req.params.id as string;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return ApiResponse(res, 400, false, "Please provide both startDate and endDate");
    }

    const start = moment.tz(startDate as string, IST).startOf("day").toDate();
    const end = moment.tz(endDate as string, IST).endOf("day").toDate();

    const customer = await Customer.findOne({ _id: customerId, shopId });
    if (!customer) {
      return ApiResponse(res, 404, false, "Customer not found");
    }
    // 1. Fetch EVERYTHING in parallel: Aggregates for Opening Balance + Actual Records for the Range
    const [
      billsBefore,
      txnsBefore,
      returnsBefore,
      billsRange,
      txnsRange,
      returnsRange
    ] = await Promise.all([
      // Aggregates for Opening Balance (pre-start)
      Bill.aggregate([
        scopedMatch(shopId, { customer: new mongoose.Types.ObjectId(customerId), createdAt: { $lt: start } }),
        { $group: { _id: null, totalChange: { $sum: { $subtract: [{ $subtract: ["$productsTotal", { $ifNull: ["$discount", 0] }] }, "$payment"] } } } }
      ]),
      Transaction.aggregate([
        scopedMatch(shopId, { customer: new mongoose.Types.ObjectId(customerId), approved: true, createdAt: { $lt: start } }),
        { $group: { _id: null, totalChange: { $sum: { $cond: ["$paymentIn", { $multiply: ["$amount", -1] }, "$amount"] } } } }
      ]),
      ReturnBill.aggregate([
        scopedMatch(shopId, { customer: new mongoose.Types.ObjectId(customerId), paymentMode: 'ADJUSTMENT', createdAt: { $lt: start } }),
        { $group: { _id: null, totalChange: { $sum: "$totalAmount" } } }
      ]),
      // Actual records within range
      Bill.find({ shopId, customer: customerId, createdAt: { $gte: start, $lte: end } }).lean(),
      Transaction.find({ shopId, customer: customerId, approved: true, createdAt: { $gte: start, $lte: end } }).lean(),
      ReturnBill.find({ shopId, customer: customerId, createdAt: { $gte: start, $lte: end } }).lean()
    ]);

    // 2. Calculate Opening Balance
    const openingBalance = (billsBefore[0]?.totalChange || 0) +
      (txnsBefore[0]?.totalChange || 0) -
      (returnsBefore[0]?.totalChange || 0);

    // 3. Map to common format for sorting
    const rangeHistory: any[] = [
      ...billsRange.map((b: any) => {
        const netChange = ((b.productsTotal || 0) - (b.discount || 0)) - b.payment;
        return {
          type: 'BILL',
          date: b.createdAt,
          amount: (b.productsTotal || 0) - (b.discount || 0),
          payment: b.payment,
          netChange,
          previousBalance: b.total - netChange,
          newBalance: b.total,
          description: `Bill #${b.id}`,
          id: b._id,
          refId: b.id,
          _original: b
        };
      }),
      ...txnsRange.map((t: any) => ({
        type: 'TRANSACTION',
        date: t.createdAt,
        amount: t.amount,
        paymentIn: t.paymentIn,
        netChange: t.paymentIn ? -t.amount : t.amount,
        previousBalance: t.previousOutstanding,
        newBalance: t.newOutstanding,
        description: t.purpose || (t.paymentIn ? 'Payment Received' : 'Cash Given'),
        id: t._id,
        refId: t.id,
        _original: t
      })),
      ...returnsRange.map((rb: any) => ({
        type: 'RETURN',
        date: rb.createdAt,
        amount: rb.totalAmount,
        paymentMode: rb.paymentMode,
        netChange: rb.paymentMode === 'ADJUSTMENT' ? -rb.totalAmount : 0,
        previousBalance: rb.previousOutstanding,
        newBalance: rb.newOutstanding,
        description: `Return #${rb.id}`,
        id: rb._id,
        refId: rb.id,
        _original: rb
      }))
    ];

    // 4. Sort Descending (Newest first for UI)
    rangeHistory.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Calculate closing balance from the first (most recent) item
    const closingBalance = rangeHistory.length > 0 ? rangeHistory[0].newBalance : openingBalance;

    return ApiResponse(res, 200, true, "Customer history retrieved successfully", {
      customer: {
        name: customer.name,
        phone: customer.phone,
        currentOutstanding: customer.outstanding
      },
      openingBalance,
      history: rangeHistory,
      closingBalance
    });

  } catch (error: any) {
    console.error("Error fetching customer history:", error);
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

export const getCustomerBills = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const customerId = req.params.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    const bills = await Bill.find({ shopId, customer: customerId })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Bill.countDocuments({ shopId, customer: customerId });

    return ApiResponse(res, 200, true, "Customer bills retrieved", {
      bills,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message);
  }
};

export const getCustomerTransactions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const customerId = req.params.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    const transactions = await Transaction.find({ shopId, customer: customerId, approved: true })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Transaction.countDocuments({ shopId, customer: customerId, approved: true });

    return ApiResponse(res, 200, true, "Customer transactions retrieved", {
      transactions,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message);
  }
};

export const getCustomerReturns = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const customerId = req.params.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    const returnBills = await ReturnBill.find({ shopId, customer: customerId })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await ReturnBill.countDocuments({ shopId, customer: customerId });

    return ApiResponse(res, 200, true, "Customer return bills retrieved", {
      returnBills,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message);
  }
};

export const getCustomerJourneys = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const customerId = req.params.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    const user = req.user;
    const roles = req.shopMember?.roles || [];
    if (!user || !roles.some((role) => ["SUPER_ADMIN", "ADMIN", "CREATOR"].includes(role))) {
      return ApiResponse(res, 403, false, "Unauthorized access to journey logs");
    }

    const journeys = await CustomerJourney.find({ shopId, customer: customerId })
      .populate("user", "name username")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await CustomerJourney.countDocuments({ shopId, customer: customerId });

    return ApiResponse(res, 200, true, "Customer journeys retrieved", {
      journeys,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message);
  }
};
