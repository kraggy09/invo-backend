import { Request, Response } from "express";
import User from "../models/user.model";
import ApiResponse from "../utils/ApiResponse";
import bcrypt from "bcrypt";
import Bill from "../models/bill.model";
import Transaction from "../models/transaction.model";
import Customer from "../models/customer.model";
import mongoose from "mongoose";
import ACL from "../models/acl.model";
import ACLUser from "../models/aclUser.model";

export const addUserToCompany = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, username, password, aclId } = req.body;
    const user = await User.findOne({ username }).session(session);
    if (user) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 404, false, "User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create(
      [
        {
          name,
          username,
          password: hashedPassword,
        },
      ],
      { session }
    );

    if (!newUser || newUser.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 400, false, "Unable to create user");
    }

    if (aclId) {
      await ACLUser.create(
        [
          {
            user: newUser[0]._id,
            acl: aclId,
          },
        ],
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    return ApiResponse(res, 201, true, "User created successfully", {
      user: newUser[0],
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await User.find().select("-password").lean();
    if (!users) {
      return ApiResponse(res, 400, false, "No users found");
    }

    // Populate roles for each user
    const usersWithRoles = await Promise.all(
      users.map(async (user: any) => {
        const userAclEntries = await ACLUser.find({ user: user._id })
          .populate("acl", "name")
          .select("acl")
          .lean();
        const roles = userAclEntries
          .map((entry: any) => entry.acl?.name)
          .filter(Boolean);
        return { ...user, roles };
      })
    );

    return ApiResponse(res, 200, true, "Users found", {
      users: usersWithRoles,
    });
  } catch (error) {
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

export const getAllAclRoles = async (req: Request, res: Response) => {
  try {
    const acls = await ACL.find();
    return ApiResponse(res, 200, true, "ACLs found", { acls });
  } catch (error) {
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

export const getAdminData = async (req: Request, res: Response) => {
  try {
    let date = new Date();
    let { days } = req.body;

    // Define date ranges
    const startCurrent = new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
    startCurrent.setHours(0, 0, 0, 0);

    const endCurrent = new Date(date.getTime() - 1 * 24 * 60 * 60 * 1000);
    endCurrent.setHours(23, 59, 59, 999);

    const startPrevious = new Date(
      date.getTime() - days * 2 * 24 * 60 * 60 * 1000
    );
    startPrevious.setHours(0, 0, 0, 0);

    const endPrevious = new Date(
      date.getTime() - (days + 1) * 24 * 60 * 60 * 1000
    );
    endPrevious.setHours(23, 59, 59, 999);

    const todayStart = new Date(date);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(date);
    todayEnd.setHours(23, 59, 59, 999);

    // Helper function for aggregations
    const aggregateSales = (start: Date, end: Date) => {
      return Bill.aggregate([
        {
          $match: {
            createdAt: {
              $gte: start,
              $lte: end,
            },
          },
        },
        {
          $addFields: {
            BillTotal: {
              $cond: {
                if: { $gt: [{ $ifNull: ["$productsTotal", 0] }, 0] },
                then: "$productsTotal",
                else: { $sum: "$items.total" },
              },
            },
          },
        },
        {
          $group: {
            _id: "", // Group by empty string to get overall total
            overallSales: {
              $sum: "$BillTotal",
            },
            count: {
              $sum: 1,
            },
          },
        },
      ]).option({ allowDiskUse: true });
    };

    // Helper function for transaction aggregations
    const aggregateTransactions = (start: Date, end: Date) => {
      return Transaction.aggregate([
        {
          $match: {
            createdAt: {
              $gte: start,
              $lte: end,
            },
            paymentIn: true,
          },
        },
        {
          $group: {
            _id: "",
            overallPayment: {
              $sum: "$amount",
            },
          },
        },
      ]).option({ allowDiskUse: true });
    };

    // Current and Previous Sales Aggregations
    let [totalCurrSales, totalPreviousSales] = await Promise.all([
      aggregateSales(startCurrent, endCurrent),
      aggregateSales(startPrevious, endPrevious),
    ]);

    // Current and Previous Transactions Aggregations
    let [currentTransactions, previousTransaction] = await Promise.all([
      aggregateTransactions(startCurrent, endCurrent),
      aggregateTransactions(startPrevious, endPrevious),
    ]);

    // Daily sales
    let sales = await Bill.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startCurrent,
            $lte: endCurrent,
          },
        },
      },
      {
        $addFields: {
          dateOnly: {
            $dateToString: {
              format: "%m-%d-%Y",
              date: "$date",
            },
          },
          BillTotal: {
            $cond: {
              if: { $gt: [{ $ifNull: ["$productsTotal", 0] }, 0] },
              then: "$productsTotal",
              else: { $sum: "$items.total" },
            },
          },
        },
      },
      {
        $group: {
          _id: "$dateOnly",
          totalAmount: {
            $sum: "$BillTotal",
          },
        },
      },
      {
        $sort: {
          _id: 1,
        },
      },
    ]).option({ allowDiskUse: true });

    // Daily transactions
    let trans = await Transaction.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startCurrent,
            $lte: endCurrent,
          },
          paymentIn: true,
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%m-%d-%Y", date: "$createdAt" },
          },
          totalTrans: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          _id: 1,
        },
      },
    ]).option({ allowDiskUse: true });
    let outstanding = await Customer.aggregate([
      {
        $group: {
          _id: "",
          cash: {
            $sum: "$outstanding",
          },
        },
      },
    ]).option({ allowDiskUse: true });

    // Payment Status Aggregation
    const paymentStatus = await Bill.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$total" },
        }
      },
      {
        $project: {
          status: "$_id",
          count: 1,
          amount: 1,
          _id: 0
        }
      }
    ]).option({ allowDiskUse: true });

    // Optimized Product Statistics Aggregation
    const productStatsAgg = await Bill.aggregate([
      {
        $match: {
          $or: [
            { createdAt: { $gte: startCurrent, $lte: endCurrent } },
            { createdAt: { $gte: startPrevious, $lte: endPrevious } }
          ]
        }
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          currentRevenue: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ["$createdAt", startCurrent] }, { $lte: ["$createdAt", endCurrent] }] },
                "$items.total",
                0
              ]
            }
          },
          currentSales: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ["$createdAt", startCurrent] }, { $lte: ["$createdAt", endCurrent] }] },
                "$items.quantity",
                0
              ]
            }
          },
          previousRevenue: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ["$createdAt", startPrevious] }, { $lte: ["$createdAt", endPrevious] }] },
                "$items.total",
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "productDoc"
        }
      },
      { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: { $ifNull: ["$productDoc.name", "Unknown Product"] },
          sales: "$currentSales",
          revenue: "$currentRevenue",
          change: {
            $let: {
              vars: {
                diff: { $subtract: ["$currentRevenue", "$previousRevenue"] }
              },
              in: {
                $cond: {
                  if: { $eq: ["$previousRevenue", 0] },
                  then: { $cond: [{ $gt: ["$currentRevenue", 0] }, "+100%", "0%"] },
                  else: {
                    $concat: [
                      { $cond: [{ $gte: ["$$diff", 0] }, "+", ""] },
                      { $toString: { $round: [{ $multiply: [{ $divide: ["$$diff", "$previousRevenue"] }, 100] }, 1] } },
                      "%"
                    ]
                  }
                }
              }
            }
          }
        }
      },
      {
        $facet: {
          topProducts: [
            { $match: { revenue: { $gt: 0 } } },
            { $sort: { revenue: -1 } },
            { $limit: 10 }
          ],
          lowSellingProducts: [
            { $match: { revenue: { $gt: 0 } } },
            { $sort: { revenue: 1 } },
            { $limit: 5 }
          ]
        }
      }
    ]).option({ allowDiskUse: true });

    const topProducts = productStatsAgg[0].topProducts;
    const lowSellingProducts = productStatsAgg[0].lowSellingProducts;

    // Recent Customers
    const recentBills = await Bill.find()
      .populate('customer', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentCustomers = recentBills.map((bill: any) => ({
      name: bill.customer?.name || "Unknown",
      amount: bill.total,
      time: bill.createdAt.toISOString(),
      type: "Regular" // default
    }));

    // Customer Stats
    const totalCustomers = await Customer.countDocuments();
    const newCustomers = await Customer.countDocuments({
      createdAt: { $gte: startCurrent, $lte: endCurrent }
    });

    // Active customers are customers who had a bill in the current period
    const activeCustomersAgg = await Bill.aggregate([
      { $match: { createdAt: { $gte: startCurrent, $lte: endCurrent } } },
      { $group: { _id: "$customer" } },
      { $count: "activeCount" }
    ]).option({ allowDiskUse: true });
    const activeCustomers = activeCustomersAgg.length > 0 ? activeCustomersAgg[0].activeCount : 0;

    const quickStats = {
      totalCustomers,
      activeCustomers,
      newCustomers,
      returningCustomers: activeCustomers - newCustomers > 0 ? activeCustomers - newCustomers : 0
    };

    // Daily Summary
    const todayBills = await Bill.aggregate([
      { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
      {
        $addFields: {
          calculatedTotal: {
            $cond: {
              if: { $gt: [{ $ifNull: ["$productsTotal", 0] }, 0] },
              then: "$productsTotal",
              else: { $sum: "$items.total" },
            },
          },
        },
      },
      {
        $group: {
          _id: { $hour: "$createdAt" },
          totalAmount: { $sum: "$calculatedTotal" },
          count: { $sum: 1 }
        }
      },
      { $sort: { totalAmount: -1 } }
    ]).option({ allowDiskUse: true });

    const todaySales = todayBills.reduce((acc, curr) => acc + curr.totalAmount, 0);
    const todayTransactions = await Transaction.countDocuments({
      createdAt: { $gte: todayStart, $lte: todayEnd },
      paymentIn: true,
    });
    const averageTicket = todayTransactions > 0 ? Math.round(todaySales / todayTransactions) : 0;

    let peakHour = "N/A";
    if (todayBills.length > 0) {
      const peakHourNum = todayBills[0]._id;
      peakHour = `${String(peakHourNum).padStart(2, '0')}:00 - ${String(peakHourNum + 1).padStart(2, '0')}:00`;
    }

    const topProductTodayAgg = await Bill.aggregate([
      { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "productDoc"
        }
      },
      { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ["$productDoc.name", "Unknown Product"] },
          sales: { $sum: "$items.quantity" },
          revenue: { $sum: "$items.total" }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 3 }
    ]).option({ allowDiskUse: true });

    const topProductsToday = topProductTodayAgg.map(p => ({
      name: p._id,
      sales: p.sales,
      revenue: p.revenue
    }));

    const dailySummary = {
      todaySales,
      todayTransactions,
      averageTicket,
      peakHour,
      topProductsToday
    };

    // Send the aggregated data as response
    return res.status(200).json({
      totalCurrSales,
      totalPreviousSales,
      currentTransactions,
      previousTransaction,
      sales,
      trans,
      outstanding: outstanding.length > 0 ? outstanding[0].cash : 0,
      paymentStatus,
      topProducts,
      lowSellingProducts,
      recentCustomers,
      quickStats,
      dailySummary
    });
  } catch (error) {
    console.error("Error in getAdminData: ", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const assignRoleToUser = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId, aclId } = req.body;

    if (!userId || !aclId) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 400, false, "User ID and Role ID are required");
    }

    // Check if user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 404, false, "User not found");
    }

    // Check if role exists
    const acl = await ACL.findById(aclId).session(session);
    if (!acl) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 404, false, "Role not found");
    }

    // Check if user already has this role
    const existingAclUser = await ACLUser.findOne({ user: userId, acl: aclId }).session(session);
    if (existingAclUser) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 400, false, "User already has this role");
    }

    // Assign the role
    await ACLUser.create([{ user: userId, acl: aclId }], { session });

    await session.commitTransaction();
    session.endSession();

    return ApiResponse(res, 200, true, "Role assigned successfully");
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId } = req.params;

    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 400, false, "User ID is required");
    }

    // Check if user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 404, false, "User not found");
    }

    // Check user roles
    const userAclEntries = await ACLUser.find({ user: userId })
      .populate("acl", "name")
      .session(session);

    const roles = userAclEntries
      .map((entry: any) => entry.acl?.name)
      .filter(Boolean);

    if (roles.includes("SUPER_ADMIN") || roles.includes("CREATOR")) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 403, false, "Cannot delete users with SUPER_ADMIN or CREATOR roles");
    }

    // Delete user and their ACL entries
    await ACLUser.deleteMany({ user: userId }).session(session);
    await User.findByIdAndDelete(userId).session(session);

    await session.commitTransaction();
    session.endSession();

    return ApiResponse(res, 200, true, "User deleted successfully");
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

//Todo: Low Priority (Write an aggreagate function to get the profit of the single customer too)

export const getCustomerData = async (req: Request, res: Response) => {
  let { days, customerId } = req.body;
  customerId = new mongoose.Types.ObjectId(customerId);
  let date = new Date();
  const startCurrent = new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
  startCurrent.setHours(0, 0, 0, 0);

  const endCurrent = new Date(date.getTime() - 1 * 24 * 60 * 60 * 1000);
  endCurrent.setHours(23, 59, 59, 999);

  const startPrevious = new Date(
    date.getTime() - days * 2 * 24 * 60 * 60 * 1000
  );
  startPrevious.setHours(0, 0, 0, 0);

  const endPrevious = new Date(
    date.getTime() - (days + 1) * 24 * 60 * 60 * 1000
  );
  endPrevious.setHours(23, 59, 59, 999);

  let foundCustomer = await Customer.findOne({ _id: customerId });

  if (!foundCustomer) {
    return ApiResponse(res, 404, false, "Customer not found");
  }
  // Helper function for aggregations
  const aggregateSales = (start: Date, end: Date) => {
    return Bill.aggregate([
      {
        $match: {
          customer: customerId,
          createdAt: {
            $gte: start,
            $lte: end,
          },
        },
      },
      {
        $addFields: {
          BillTotal: {
            $cond: {
              if: { $gt: [{ $ifNull: ["$productsTotal", 0] }, 0] },
              then: "$productsTotal",
              else: { $sum: "$items.total" },
            },
          },
        },
      },
      {
        $group: {
          _id: "", // Group by empty string to get overall total
          overallSales: {
            $sum: "$BillTotal",
          },
          count: {
            $sum: 1,
          },
        },
      },
    ]).option({ allowDiskUse: true });
  };

  // Helper function for transaction aggregations
  const aggregateTransactions = (start: Date, end: Date) => {
    return Transaction.aggregate([
      {
        $match: {
          name: foundCustomer.name,
          createdAt: {
            $gte: start,
            $lte: end,
          },
          paymentIn: true,
        },
      },
      {
        $group: {
          _id: "",
          overallPayment: {
            $sum: "$amount",
          },
        },
      },
    ]).option({ allowDiskUse: true });
  };

  // Current and Previous Sales Aggregations
  let [totalCurrSales, totalPreviousSales] = await Promise.all([
    aggregateSales(startCurrent, endCurrent),
    aggregateSales(startPrevious, endPrevious),
  ]);

  // Current and Previous Transactions Aggregations
  let [currentTransactions, previousTransaction] = await Promise.all([
    aggregateTransactions(startCurrent, endCurrent),
    aggregateTransactions(startPrevious, endPrevious),
  ]);

  // Daily sales
  let sales = await Bill.aggregate([
    {
      $match: {
        customer: customerId,
        createdAt: {
          $gte: startCurrent,
          $lte: endCurrent,
        },
      },
    },
    {
      $addFields: {
        dateOnly: {
          $dateToString: {
            format: "%m-%d-%Y",
            date: "$date",
          },
        },
        BillTotal: {
          $cond: {
            if: { $gt: [{ $ifNull: ["$productsTotal", 0] }, 0] },
            then: "$productsTotal",
            else: { $sum: "$items.total" },
          },
        },
      },
    },
    {
      $group: {
        _id: "$dateOnly",
        totalAmount: {
          $sum: "$BillTotal",
        },
      },
    },
    {
      $sort: {
        _id: 1,
      },
    },
  ]).option({ allowDiskUse: true });

  // Daily transactions
  let trans = await Transaction.aggregate([
    {
      $match: {
        name: foundCustomer.name,
        createdAt: {
          $gte: startCurrent,
          $lte: endCurrent,
        },
        paymentIn: true,
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%m-%d-%Y", date: "$createdAt" },
        },
        totalTrans: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    {
      $sort: {
        _id: 1,
      },
    },
  ]).option({ allowDiskUse: true });

  console.log({
    totalCurrSales,
    totalPreviousSales,
    currentTransactions,
    previousTransaction,
    sales,
    trans,
  });

  // Send the aggregated data as response
  return res.status(200).json({
    totalCurrSales,
    totalPreviousSales,
    currentTransactions,
    previousTransaction,
    sales,
    trans,
  });
};
