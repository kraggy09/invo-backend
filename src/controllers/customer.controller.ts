import Customer from "../models/customer.model";
import { Request, Response } from "express";
import ApiResponse from "../utils/ApiResponse";
import Bill from "../models/bill.model";
import ReturnBill from "../models/returnBill.model";
import Transaction from "../models/transaction.model";
import { EVENTS_MAP } from "../constant/redisMap";
import mongoose from "mongoose";
import { addJourneyLog } from "../services/logger.service";

export const createNewCustomer = async (req: Request, res: Response) => {
  try {
    const customerData = req.body;
    let { name, outstanding, phone } = customerData;
    if (phone.length != 10) {
      return ApiResponse(res, 400, false, "Phone number should be of 10 digit");
    }
    name = name.toLowerCase().trim();
    let customer = await Customer.findOne({ name });
    if (customer) {
      return ApiResponse(res, 404, false, "Customer already exists");
    }
    customer = await Customer.findOne({ phone });
    if (customer) {
      return ApiResponse(res, 404, false, "Customer already exists");
    }

    const newCustomer = await Customer.create({
      name,
      outstanding,
      phone,
    });

    const io = req.app.get("io");
    if (io) {
      io.emit(EVENTS_MAP.CUSTOMER_CREATED, newCustomer);
    }

    await addJourneyLog(
      req,
      "CUSTOMER_CREATED",
      `Customer ${newCustomer.name} created`,
      (req as any).user?._id || null,
      "Customer",
      newCustomer._id,
      { phone: newCustomer.phone, outstanding: newCustomer.outstanding }
    );

    return ApiResponse(res, 201, true, "Customer created successfully", {
      customer: newCustomer,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server error");
  }
};

export const getAllCustomers = async (req: Request, res: Response) => {
  try {
    const customers = await Customer.find();

    if (customers && customers.length > 0) {
      return ApiResponse(res, 200, true, "List of customers", { customers });
    }

    return ApiResponse(res, 404, false, "No customers found");
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};

export const getSingleCustomer = async (req: Request, res: Response) => {
  const customerId = req.params.id; // Access the customer ID from the route parameter

  try {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return ApiResponse(res, 404, false, "Customer not found");
    }

    let bills = await Bill.find({ customer: customerId })
      .populate("createdBy", "name email")
      .sort({
        createdAt: -1,
      });

    let returnBills = await ReturnBill.find({ customer: customerId })
      .populate("createdBy", "name email")
      .sort({
        createdAt: -1,
      });

    let transactions = await Transaction.find({
      customer: customerId,
      approved: true,
    }).sort({
      createdAt: -1,
    });

    const newCustomer = { ...customer.toObject(), bills, returnBills, transactions };

    return ApiResponse(res, 200, true, "Customer found successfully", {
      customer: newCustomer,
    });
  } catch (error: any) {
    console.error("Error fetching customer:", error);
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

export const getCustomerAnalytics = async (req: Request, res: Response) => {
  try {
    const customerId = req.params.id;
    let days = parseInt(req.query.days as string) || 7;

    // Validate days ranges
    if (![7, 15, 30, 45].includes(days)) {
      days = 7;
    }

    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);

    // 1. Fetch Bills for Sales & Profit
    const billsAgg = await Bill.aggregate([
      {
        $match: {
          customer: new mongoose.Types.ObjectId(customerId),
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
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

    // 2. Fetch Transactions for Payments
    const txAgg = await Transaction.aggregate([
      {
        $match: {
          customer: new mongoose.Types.ObjectId(customerId),
          createdAt: { $gte: startDate, $lte: endDate },
          approved: true,      // Confirmed only
          $or: [
            { paymentIn: true },
            { paymentIn: { $exists: false }, taken: false } // Legacy support
          ]
        }
      },
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
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];

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
