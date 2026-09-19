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
import ShopMember from "../models/shopMember.model";
import Shop from "../models/shop.model";
import moment from "moment-timezone";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import { scopedMatch } from "../utils/scopedMatch";

const IST = "Asia/Kolkata";

/**
 * Add a user to the current shop as a member.
 * Can create a new user account or add an existing user.
 */
export const addUserToCompany = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const shopId = req.shopId;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, username, password, roles = ["WORKER"] } = req.body;
    let user = await User.findOne({ username }).session(session);

    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUsers = await User.create(
        [{ name, username, password: hashedPassword }],
        { session },
      );

      if (!newUsers || newUsers.length === 0) {
        await session.abortTransaction();
        session.endSession();
        return ApiResponse(res, 400, false, "Unable to create user");
      }
      user = newUsers[0];
    }

    // Check if user is already a member of this shop
    const existingMembership = await ShopMember.findOne({
      user: user._id,
      shop: shopId,
    }).session(session);

    if (existingMembership) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(
        res,
        409,
        false,
        "User is already a member of this shop",
      );
    }

    const shopMember = await ShopMember.create(
      [{ shop: shopId, user: user._id, roles, isActive: true }],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    const userWithoutPassword = user.toObject();
    delete (userWithoutPassword as any).password;

    return ApiResponse(res, 201, true, "User added to shop successfully", {
      user: { ...userWithoutPassword, roles },
      membership: shopMember[0],
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

/**
 * Get all members of the current shop.
 */
export const getAllUsers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId;

    const members = await ShopMember.find({ shop: shopId })
      .populate("user", "-password")
      .lean();

    const users = members.map((m: any) => ({
      ...m.user,
      roles: m.roles,
      isActive: m.isActive,
      membershipId: m._id,
    }));

    return ApiResponse(res, 200, true, "Users found", { users });
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

/**
 * Admin dashboard data — all aggregations SCOPED to the current shop.
 */
export const getAdminData = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    let { days } = req.body;

    const startCurrent = moment
      .tz(IST)
      .subtract(days, "days")
      .startOf("day")
      .toDate();
    const endCurrent = moment.tz(IST).subtract(1, "days").endOf("day").toDate();

    const startPrevious = moment
      .tz(IST)
      .subtract(days * 2, "days")
      .startOf("day")
      .toDate();
    const endPrevious = moment
      .tz(IST)
      .subtract(days + 1, "days")
      .endOf("day")
      .toDate();

    const todayStart = moment.tz(IST).startOf("day").toDate();
    const todayEnd = moment.tz(IST).endOf("day").toDate();

    const aggregateSales = (start: Date, end: Date) => {
      return Bill.aggregate([
        scopedMatch(shopId, { createdAt: { $gte: start, $lte: end } }),
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
            _id: "",
            overallSales: { $sum: "$BillTotal" },
            count: { $sum: 1 },
          },
        },
      ]).option({ allowDiskUse: true });
    };

    const aggregateTransactions = (start: Date, end: Date) => {
      return Transaction.aggregate([
        scopedMatch(shopId, {
          createdAt: { $gte: start, $lte: end },
          paymentIn: true,
        }),
        {
          $group: {
            _id: "",
            overallPayment: { $sum: "$amount" },
          },
        },
      ]).option({ allowDiskUse: true });
    };

    let [totalCurrSales, totalPreviousSales] = await Promise.all([
      aggregateSales(startCurrent, endCurrent),
      aggregateSales(startPrevious, endPrevious),
    ]);

    let [currentTransactions, previousTransaction] = await Promise.all([
      aggregateTransactions(startCurrent, endCurrent),
      aggregateTransactions(startPrevious, endPrevious),
    ]);

    // Daily sales — scoped
    let sales = await Bill.aggregate([
      scopedMatch(shopId, {
        createdAt: { $gte: startCurrent, $lte: endCurrent },
      }),
      {
        $addFields: {
          dateOnly: {
            $dateToString: { format: "%m-%d-%Y", date: "$date" },
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
          totalAmount: { $sum: "$BillTotal" },
        },
      },
      { $sort: { _id: 1 } },
    ]).option({ allowDiskUse: true });

    // Daily transactions — scoped
    let trans = await Transaction.aggregate([
      scopedMatch(shopId, {
        createdAt: { $gte: startCurrent, $lte: endCurrent },
        paymentIn: true,
      }),
      {
        $group: {
          _id: { $dateToString: { format: "%m-%d-%Y", date: "$createdAt" } },
          totalTrans: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).option({ allowDiskUse: true });

    // Outstanding — scoped to this shop's customers only
    let outstanding = await Customer.aggregate([
      scopedMatch(shopId),
      {
        $group: {
          _id: "",
          cash: { $sum: "$outstanding" },
        },
      },
    ]).option({ allowDiskUse: true });

    // Payment Status Aggregation — scoped
    const paymentStatus = await Bill.aggregate([
      scopedMatch(shopId),
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$total" },
        },
      },
      {
        $project: {
          status: "$_id",
          count: 1,
          amount: 1,
          _id: 0,
        },
      },
    ]).option({ allowDiskUse: true });

    // Optimized Product Statistics Aggregation — scoped
    const productStatsAgg = await Bill.aggregate([
      scopedMatch(shopId, {
        $or: [
          { createdAt: { $gte: startCurrent, $lte: endCurrent } },
          { createdAt: { $gte: startPrevious, $lte: endPrevious } },
        ],
      }),
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          currentRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", startCurrent] },
                    { $lte: ["$createdAt", endCurrent] },
                  ],
                },
                "$items.total",
                0,
              ],
            },
          },
          currentSales: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", startCurrent] },
                    { $lte: ["$createdAt", endCurrent] },
                  ],
                },
                "$items.quantity",
                0,
              ],
            },
          },
          previousRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", startPrevious] },
                    { $lte: ["$createdAt", endPrevious] },
                  ],
                },
                "$items.total",
                0,
              ],
            },
          },
        },
      },
      {
        // Pipeline-based $lookup: scope the products join to THIS shop only
        $lookup: {
          from: "products",
          let: { productId: "$_id", shopId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$_id", "$$productId"] },
                    { $eq: ["$shopId", "$$shopId"] },
                  ],
                },
              },
            },
            { $project: { name: 1 } },
          ],
          as: "productDoc",
        },
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
                diff: { $subtract: ["$currentRevenue", "$previousRevenue"] },
              },
              in: {
                $cond: {
                  if: { $eq: ["$previousRevenue", 0] },
                  then: {
                    $cond: [{ $gt: ["$currentRevenue", 0] }, "+100%", "0%"],
                  },
                  else: {
                    $concat: [
                      { $cond: [{ $gte: ["$$diff", 0] }, "+", ""] },
                      {
                        $toString: {
                          $round: [
                            {
                              $multiply: [
                                { $divide: ["$$diff", "$previousRevenue"] },
                                100,
                              ],
                            },
                            1,
                          ],
                        },
                      },
                      "%",
                    ],
                  },
                },
              },
            },
          },
        },
      },
      {
        $facet: {
          topProducts: [
            { $match: { revenue: { $gt: 0 } } },
            { $sort: { revenue: -1 } },
            { $limit: 10 },
          ],
          lowSellingProducts: [
            { $match: { revenue: { $gt: 0 } } },
            { $sort: { revenue: 1 } },
            { $limit: 5 },
          ],
        },
      },
    ]).option({ allowDiskUse: true });

    const topProducts = productStatsAgg[0].topProducts;
    const lowSellingProducts = productStatsAgg[0].lowSellingProducts;

    // Recent Customers — scoped
    const recentBills = await Bill.find({ shopId })
      .populate("customer", "name")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentCustomers = recentBills.map((bill: any) => ({
      name: bill.customer?.name || "Unknown",
      amount: bill.total,
      time: bill.createdAt.toISOString(),
      type: "Regular",
    }));

    // Customer Stats — scoped
    const totalCustomers = await Customer.countDocuments({ shopId });
    const newCustomers = await Customer.countDocuments({
      shopId,
      createdAt: { $gte: startCurrent, $lte: endCurrent },
    });

    const activeCustomersAgg = await Bill.aggregate([
      scopedMatch(shopId, {
        createdAt: { $gte: startCurrent, $lte: endCurrent },
      }),
      { $group: { _id: "$customer" } },
      { $count: "activeCount" },
    ]).option({ allowDiskUse: true });
    const activeCustomers =
      activeCustomersAgg.length > 0 ? activeCustomersAgg[0].activeCount : 0;

    const quickStats = {
      totalCustomers,
      activeCustomers,
      newCustomers,
      returningCustomers:
        activeCustomers - newCustomers > 0 ? activeCustomers - newCustomers : 0,
    };

    // Daily Summary — scoped
    const todayBills = await Bill.aggregate([
      scopedMatch(shopId, { createdAt: { $gte: todayStart, $lte: todayEnd } }),
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
          count: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]).option({ allowDiskUse: true });

    const todaySales = todayBills.reduce(
      (acc: number, curr: any) => acc + curr.totalAmount,
      0,
    );
    const todayTransactions = await Transaction.countDocuments({
      shopId,
      createdAt: { $gte: todayStart, $lte: todayEnd },
      paymentIn: true,
    });
    const averageTicket =
      todayTransactions > 0 ? Math.round(todaySales / todayTransactions) : 0;

    let peakHour = "N/A";
    if (todayBills.length > 0) {
      const peakHourNum = todayBills[0]._id;
      peakHour = `${String(peakHourNum).padStart(2, "0")}:00 - ${String(peakHourNum + 1).padStart(2, "0")}:00`;
    }

    const topProductTodayAgg = await Bill.aggregate([
      scopedMatch(shopId, { createdAt: { $gte: todayStart, $lte: todayEnd } }),
      { $unwind: "$items" },
      {
        // Pipeline-based $lookup: scope the products join to THIS shop only
        $lookup: {
          from: "products",
          let: { productId: "$items.product", shopId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$_id", "$$productId"] },
                    { $eq: ["$shopId", "$$shopId"] },
                  ],
                },
              },
            },
            { $project: { name: 1 } },
          ],
          as: "productDoc",
        },
      },
      { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ["$productDoc.name", "Unknown Product"] },
          sales: { $sum: "$items.quantity" },
          revenue: { $sum: "$items.total" },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 3 },
    ]).option({ allowDiskUse: true });

    const topProductsToday = topProductTodayAgg.map((p: any) => ({
      name: p._id,
      sales: p.sales,
      revenue: p.revenue,
    }));

    const dailySummary = {
      todaySales,
      todayTransactions,
      averageTicket,
      peakHour,
      topProductsToday,
    };

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
      dailySummary,
    });
  } catch (error) {
    console.error("Error in getAdminData: ", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const assignRoleToUser = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const shopId = req.shopId!;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId, roles } = req.body;

    if (!userId || !roles) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 400, false, "User ID and roles are required");
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 404, false, "User not found");
    }

    // Update ShopMember roles for this shop
    const membership = await ShopMember.findOneAndUpdate(
      { user: userId, shop: shopId },
      { $set: { roles } },
      { new: true, session },
    );

    if (!membership) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 404, false, "User is not a member of this shop");
    }

    await session.commitTransaction();
    session.endSession();

    return ApiResponse(res, 200, true, "Role assigned successfully", {
      membership,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

export const deleteUser = async (req: AuthenticatedRequest, res: Response) => {
  const shopId = req.shopId!;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId } = req.params;

    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 400, false, "User ID is required");
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 404, false, "User not found");
    }

    // Find membership for this shop
    const membership = await ShopMember.findOne({
      user: userId,
      shop: shopId,
    }).session(session);
    if (!membership) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 404, false, "User is not a member of this shop");
    }

    if (
      membership.roles.includes("SUPER_ADMIN") ||
      membership.roles.includes("CREATOR")
    ) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(
        res,
        403,
        false,
        "Cannot remove users with SUPER_ADMIN or CREATOR roles",
      );
    }

    // Deactivate membership instead of deleting user account (user may belong to other shops)
    await ShopMember.findOneAndUpdate(
      { user: userId, shop: shopId },
      { isActive: false },
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    return ApiResponse(res, 200, true, "User removed from shop successfully");
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

/**
 * Get customer analytics data — SCOPED to current shop.
 */
export const getCustomerData = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const shopId = req.shopId!;
  let { days, customerId } = req.body;
  customerId = new mongoose.Types.ObjectId(customerId);
  const startCurrent = moment
    .tz(IST)
    .subtract(days, "days")
    .startOf("day")
    .toDate();
  const endCurrent = moment.tz(IST).subtract(1, "days").endOf("day").toDate();
  const startPrevious = moment
    .tz(IST)
    .subtract(days * 2, "days")
    .startOf("day")
    .toDate();
  const endPrevious = moment
    .tz(IST)
    .subtract(days + 1, "days")
    .endOf("day")
    .toDate();

  // IDOR prevention
  let foundCustomer = await Customer.findOne({ _id: customerId, shopId });

  if (!foundCustomer) {
    return ApiResponse(res, 404, false, "Customer not found");
  }

  const aggregateSales = (start: Date, end: Date) => {
    return Bill.aggregate([
      scopedMatch(shopId, {
        customer: customerId,
        createdAt: { $gte: start, $lte: end },
      }),
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
          _id: "",
          overallSales: { $sum: "$BillTotal" },
          count: { $sum: 1 },
        },
      },
    ]).option({ allowDiskUse: true });
  };

  const aggregateTransactions = (start: Date, end: Date) => {
    return Transaction.aggregate([
      scopedMatch(shopId, {
        customer: customerId,
        createdAt: { $gte: start, $lte: end },
        paymentIn: true,
      }),
      {
        $group: {
          _id: "",
          overallPayment: { $sum: "$amount" },
        },
      },
    ]).option({ allowDiskUse: true });
  };

  let [totalCurrSales, totalPreviousSales] = await Promise.all([
    aggregateSales(startCurrent, endCurrent),
    aggregateSales(startPrevious, endPrevious),
  ]);

  let [currentTransactions, previousTransaction] = await Promise.all([
    aggregateTransactions(startCurrent, endCurrent),
    aggregateTransactions(startPrevious, endPrevious),
  ]);

  let sales = await Bill.aggregate([
    scopedMatch(shopId, {
      customer: customerId,
      createdAt: { $gte: startCurrent, $lte: endCurrent },
    }),
    {
      $addFields: {
        dateOnly: {
          $dateToString: { format: "%m-%d-%Y", date: "$date" },
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
        totalAmount: { $sum: "$BillTotal" },
      },
    },
    { $sort: { _id: 1 } },
  ]).option({ allowDiskUse: true });

  let trans = await Transaction.aggregate([
    scopedMatch(shopId, {
      customer: customerId,
      createdAt: { $gte: startCurrent, $lte: endCurrent },
      paymentIn: true,
    }),
    {
      $group: {
        _id: { $dateToString: { format: "%m-%d-%Y", date: "$createdAt" } },
        totalTrans: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]).option({ allowDiskUse: true });

  return res.status(200).json({
    totalCurrSales,
    totalPreviousSales,
    currentTransactions,
    previousTransaction,
    sales,
    trans,
  });
};
