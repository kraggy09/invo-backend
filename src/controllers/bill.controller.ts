import mongoose, { ClientSession } from "mongoose";
import Counter from "../models/counter.model";
import ApiResponse from "../utils/ApiResponse";
import { Request, Response } from "express";
import Customer from "../models/customer.model";
import Product from "../models/product.model";
import Bill from "../models/bill.model";
import Transaction from "../models/transaction.model";
import moment from "moment-timezone";
import { ApiError } from "../utils";
import { EVENTS_MAP } from "../constant/redisMap";
import { journeyQueue } from "../queues/journeyQueue";


import { getNotificationRules } from "./notification.controller";
import billEvents, { BILL_EVENTS } from "../events/bill.events";
const IST = "Asia/Kolkata"; // Update with the correct path

export const createBill = async (req: Request, res: Response) => {
  const products = req.body.products;
  const {
    customerId,
    billId,
    transactionId,
    payment = 0,
    paymentMode,
    discount = 0,
    createdBy,
    idempotencyKey,
  } = req.body;

  const session: ClientSession = await mongoose.startSession();

  if (idempotencyKey) {
    const existingBill = await Bill.findOne({ idempotencyKey })
      .populate("customer")
      .populate("createdBy", "name username");

    if (existingBill) {
      const transaction = await Transaction.findOne({
        idempotencyKey: idempotencyKey,
        id: { $exists: true },
      }).sort({ createdAt: -1 });

      return ApiResponse(res, 200, true, "Bill already exists (Idempotent)", {
        bill: {
          bill: existingBill,
          updatedCustomer: existingBill.customer,
          transaction: transaction,
          billId: existingBill.id,
        },
      });
    }
  }

  try {
    // 1. Initial reads in parallel (Outside transaction to reduce lock contention and duration)
    const productIds = products.map((p: any) => new mongoose.Types.ObjectId(p.id));

    const [
      previousBillId,
      previousTransactionId,
      customer,
      availableProducts,
      notificationRules
    ] = await Promise.all([
      Counter.findOne({ name: "billId" }),
      Counter.findOne({ name: "transactionId" }),
      Customer.findById(customerId),
      Product.find(
        { _id: { $in: productIds } },
        { stock: 1, costPrice: 1, category: 1 }
      ),
      getNotificationRules(customerId)
    ]);

    if (!previousTransactionId || !previousBillId) {
      throw new ApiError(404, "Previous transactionId or billId not found");
    }

    if (previousTransactionId.value !== transactionId) {
      throw new ApiError(400, "Duplicate Transaction! Please refresh.");
    }

    if (previousBillId.value !== billId) {
      throw new ApiError(400, "Duplicate Bill! Please refresh.");
    }

    if (!customer) throw new ApiError(404, "Customer not found");

    const productMap = new Map<string, (typeof availableProducts)[0]>();
    availableProducts.forEach((prod: any) => {
      productMap.set(prod._id.toString(), prod);
    });

    const result = await session.withTransaction(async () => {

      let billTotal = 0;
      const items: any[] = [];
      const productBulkOps: any[] = [];

      const matchingNotifications = new Map<string, { rule: any, items: any[] }>();

      for (const productInput of products) {
        const quantity =
          productInput.piece +
          productInput.packet * productInput.packetQuantity +
          productInput.box * productInput.boxQuantity;

        const productIdStr = productInput.id.toString();
        const product = productMap.get(productIdStr);

        if (!product) {
          throw new ApiError(
            404,
            `Product not found: ${productInput.name || productIdStr}`
          );
        }

        billTotal += productInput.total;

        // Update stock
        productBulkOps.push({
          updateOne: {
            filter: { _id: product._id },
            update: { $inc: { stock: -quantity } },
          },
        });


        items.push({
          costPrice: product.costPrice,
          previousQuantity: product.stock,
          newQuantity: product.stock - quantity,
          productSnapshot: productInput,
          product: product._id,
          quantity,
          discount: productInput.discount || 0,
          type: productInput.type,
          total: productInput.total,
        });

        // Single-pass notification check
        const productCategory = (product.category || productInput.category)?.toLowerCase();
        if (productCategory) {
          for (const rule of notificationRules) {
            const ruleCategory = (rule.category as any)?.name?.toLowerCase();
            if (productCategory === ruleCategory) {
              const ruleId = (rule as any)._id.toString();
              if (!matchingNotifications.has(ruleId)) {
                matchingNotifications.set(ruleId, { rule, items: [] });
              }
              matchingNotifications.get(ruleId)!.items.push({
                productSnapshot: productInput,
                quantity
              });
            }
          }
        }
      }

      // Execute stock update
      const bulkResult = await Product.bulkWrite(productBulkOps, { session });
      if (bulkResult.modifiedCount !== products.length) {
        throw new ApiError(500, "Product stock update mismatch");
      }


      const netTotal = Math.ceil(billTotal + customer.outstanding - discount);

      // Increment Bill ID counter
      const newBillId = await Counter.findOneAndUpdate(
        { name: "billId" },
        { $inc: { value: 1 } },
        { new: true, session }
      );

      if (!newBillId) {
        throw new ApiError(500, "Error while generating new Bill ID");
      }

      // Create the bill
      const [newBill] = await Bill.create(
        [
          {
            customer: customerId,
            items,
            productsTotal: billTotal,
            total: netTotal,
            payment,
            discount,
            createdBy,
            id: newBillId.value,
            idempotencyKey,
          },
        ],
        { session }
      );

      if (!newBill) throw new ApiError(500, "Failed to create new bill");

      // Process payment transaction if applicable
      let transaction = null;
      let newTransactionCounter = null;

      if (payment > 0) {
        newTransactionCounter = await Counter.findOneAndUpdate(
          { name: "transactionId" },
          { $inc: { value: 1 } },
          { new: true, session }
        );

        if (!newTransactionCounter) {
          throw new ApiError(500, "Unable to get new transaction ID");
        }

        const [createdTransaction] = await Transaction.create(
          [
            {
              id: newTransactionCounter.value,
              name: customer.name,
              purpose: "Payment",
              amount: payment,
              previousOutstanding: netTotal,
              newOutstanding: netTotal - payment,
              paymentMode,
              approved: true,
              paymentIn: true,
              approvedBy: createdBy,
              customer: customer._id,
              idempotencyKey,
            },
          ],
          { session }
        );

        if (!createdTransaction) {
          throw new ApiError(400, "Transaction creation failed");
        }

        transaction = createdTransaction;
      }

      const updatedCustomer = await Customer.findByIdAndUpdate(
        customerId,
        { outstanding: netTotal - payment },
        { new: true, session }
      );

      if (!updatedCustomer) {
        throw new ApiError(400, "Failed to update customer's outstanding");
      }

      return {
        bill: newBill,
        updatedCustomer,
        transaction,
        billId: newBillId.value,
        transactionId: newTransactionCounter?.value,
        matchingNotifications,
      };
    });

    // Construct populated bill using already-available data (no extra DB call)
    const user = (req as any).user;
    const populatedBill = {
      ...result.bill.toObject(),
      customer: result.updatedCustomer,
      createdBy: user
        ? { _id: user._id, name: user.name, username: user.username }
        : result.bill.createdBy,
    };

    // Notify with socket.io
    const data = {
      ...result,
      bill: populatedBill,
      socketId: req.headers.socketid,
    };

    const io = req.app.get("io");
    io.emit(EVENTS_MAP.BILL_CREATED, data);

    // Offload journeys/logging to background worker
    journeyQueue.add("bill-created", {
      journeyLog: {
        eventType: "BILL_CREATED",
        message: `Bill #${result.billId} created for ${result.updatedCustomer.name} with total ₹${result.bill.productsTotal}`,
        createdBy,
        entityType: "Bill",
        entityId: populatedBill._id,
        metadata: {
          itemsCount: populatedBill.items.length,
          paymentReceived: payment,
          items: populatedBill.items.map((i: any) => ({ product: i.productSnapshot.name, quantity: i.quantity, price: i.price }))
        }
      },
      customerJourneyLog: {
        customerId,
        eventType: "BILL_CREATED",
        message: `Bill #${result.billId} created for ₹${result.bill.productsTotal} ${payment > 0 ? `with payment of ₹${payment}` : ""}`,
        createdBy,
        amount: result.bill.productsTotal,
        adjustments: (result.bill.total - result.bill.productsTotal),
        outstanding: result.updatedCustomer.outstanding,
        billId: populatedBill._id,
        metadata: { paymentReceived: payment, itemsCount: populatedBill.items.length }
      }
    });


    // Emit event for background processing (notifications, etc.)
    billEvents.emit(BILL_EVENTS.BILL_CREATED, {
      bill: populatedBill,
      matchingNotifications: (result as any).matchingNotifications
    });

    return ApiResponse(res, 201, true, "Bill created successfully", {
      bill: { ...result, bill: populatedBill },
    });
  } catch (error: any) {
    console.error("❌ Bill creation error:", error);
    if (error instanceof ApiError) {
      return ApiResponse(res, error.statusCode, false, error.message);
    }
    return ApiResponse(res, 500, false, error.message || "Server Error");
  } finally {
    session.endSession();
  }
};

export const getBillDetails = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    let bill;

    if (isObjectId) {
      bill = await Bill.findById(id)
        .populate("items.product")
        .populate("customer")
        .populate("createdBy", "name username");
    } else {
      const numericId = Number(id);
      if (isNaN(numericId)) {
        return ApiResponse(res, 400, false, "Invalid bill ID format");
      }
      bill = await Bill.findOne({ id: numericId })
        .populate("items.product")
        .populate("customer")
        .populate("createdBy", "name username");
    }

    if (!bill) {
      return ApiResponse(res, 404, false, "Failed to get the data of the bill");
    }

    return ApiResponse(res, 200, true, "Found the bills", { bill });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getLatestBillId = async (req: Request, res: Response) => {
  try {
    const latestBill = await Counter.findOne({ name: "billId" });
    if (latestBill) {
      const billId = latestBill.value;
      return ApiResponse(res, 200, true, "Latest Bill id", { billId });
    }
    return ApiResponse(res, 404, false, "Bill id not found restart");
  } catch (error: any) {
    console.error("Error retrieving latest bill:", error);
    return ApiResponse(res, 500, false, error.message || "Server erro");
  }
};

export async function getBillsByProductNameAndDate(
  req: Request,
  res: Response
) {
  const { product, startDate, endDate, page = 1, limit = 20 } = req.body;

  const barcode = product.barcode.map((code: any) => parseInt(code));

  try {
    const startMoment = moment(startDate).startOf("day").tz(IST);
    const endMoment = moment(endDate).endOf("day").tz(IST);
    const skip = (Number(page) - 1) * Number(limit);
    const limitNum = Number(limit);

    // Look up the exact product ID so we can do a pure DB find without lookups
    const matchingProducts = await mongoose.model("Product").find({ barcode: { $in: barcode } }).select("_id").lean();
    const productIds = matchingProducts.map((p: any) => p._id);

    const matchQuery = {
      createdAt: { $gte: startMoment.toDate(), $lte: endMoment.toDate() },
      "items.product": { $in: productIds }
    };

    // 1) Find the actual paginated bills and populate using fast DB native routines
    const [billsData, totalInstances] = await Promise.all([
      Bill.find(matchQuery)
        .populate("customer", "name phone")
        .populate("createdBy", "name username")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Bill.countDocuments(matchQuery)
    ]);

    // Format the bills items array so it ONLY contains the matching products, 
    // exactly like the previous $unwind and $match pipeline did.
    const bills = billsData.map((bill: any) => ({
      ...bill,
      items: bill.items.filter((item: any) =>
        productIds.some((pid: any) => String(pid) === String(item.product))
      )
    }));

    // 2) Compute the overall total quantity/revenue quickly without deep groupings
    const summaryAgg = await Bill.aggregate([
      { $match: matchQuery },
      { $unwind: "$items" },
      { $match: { "items.product": { $in: productIds } } },
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: "$items.quantity" },
          totalRevenue: { $sum: "$items.total" }
        }
      }
    ]);

    const summary = {
      totalInstances,
      totalQuantity: summaryAgg[0]?.totalQuantity || 0,
      totalRevenue: summaryAgg[0]?.totalRevenue || 0
    };

    return ApiResponse(res, 200, true, "Recieved successfully", {
      bills,
      total: totalInstances,
      summary,
      page: Number(page),
      limit: limitNum
    });
  } catch (error: any) {
    console.error(error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
}

export const getAllBillsInDateRange = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, page = 1, limit = 10, search } = req.query;

    if (!startDate || !endDate) {
      return ApiResponse(res, 400, false, "Both startDate and endDate are required");
    }

    const start = moment.tz(startDate as string, IST).startOf("day").toDate();
    const end = moment.tz(endDate as string, IST).endOf("day").toDate();

    const skip = (Number(page) - 1) * Number(limit);

    let matchQuery: any = {
      createdAt: {
        $gte: start,
        $lte: end,
      },
    };

    if (search) {
      const searchStr = String(search).trim();
      const numSearch = Number(searchStr);

      const customerMatch = await Customer.find({
        $or: [
          { name: { $regex: searchStr, $options: "i" } },
          { phone: { $regex: searchStr, $options: "i" } }
        ]
      }).select("_id").lean();

      const customerIds = customerMatch.map(c => c._id);

      const orConditions: any[] = [
        { customer: { $in: customerIds } }
      ];

      if (!isNaN(numSearch)) {
        orConditions.push({ id: numSearch });
      }

      matchQuery.$or = orConditions;
    }

    const [bills, total] = await Promise.all([
      Bill.find(matchQuery)
        .populate("customer", "name phone")
        .populate("createdBy", "name username")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Bill.countDocuments(matchQuery),
    ]);

    return ApiResponse(res, 200, true, "Bills found", {
      bills,
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error: any) {
    console.log(error, "This is the error you need to check");
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};

export const getBillsSummary = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return ApiResponse(
        res,
        400,
        false,
        "Both startDate and endDate are required"
      );
    }

    const start = moment.tz(startDate as string, IST).startOf("day").toDate();
    const end = moment.tz(endDate as string, IST).endOf("day").toDate();

    const [billStats, transactionStats, peakHourAgg] = await Promise.all([
      Bill.aggregate([
        {
          $match: {
            createdAt: { $gte: start, $lte: end },
          },
        },
        {
          $unwind: "$items",
        },
        {
          $group: {
            _id: null,
            totalBillAmount: { $sum: "$items.total" },
            totalInvestment: {
              $sum: {
                $multiply: [
                  "$items.quantity",
                  { $ifNull: ["$items.costPrice", 0] },
                ],
              },
            },
          },
        },
      ]).option({ allowDiskUse: true }),
      Transaction.aggregate([
        {
          $match: {
            createdAt: { $gte: start, $lte: end },
            approved: true,
          },
        },
        {
          $group: {
            _id: null,
            totalPaymentIn: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$paymentIn", true] },
                      {
                        $and: [
                          { $eq: [{ $ifNull: ["$paymentIn", null] }, null] },
                          { $eq: ["$taken", false] },
                        ],
                      },
                    ],
                  },
                  "$amount",
                  0,
                ],
              },
            },
            totalPaymentOut: {
              $sum: {
                $cond: [
                  {
                    $not: [{
                      $or: [
                        { $eq: ["$paymentIn", true] },
                        {
                          $and: [
                            { $eq: [{ $ifNull: ["$paymentIn", null] }, null] },
                            { $eq: ["$taken", false] },
                          ],
                        },
                      ],
                    }],
                  },
                  "$amount",
                  0,
                ],
              },
            },
          },
        },
      ]).option({ allowDiskUse: true }),
      Bill.aggregate([
        {
          $match: {
            createdAt: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: { $hour: "$createdAt" },
            count: { $sum: 1 },
          },
        },
        {
          $sort: { count: -1 },
        },
        {
          $limit: 1,
        },
      ]).option({ allowDiskUse: true }),
    ]);

    const result = {
      totalBillAmount: billStats[0]?.totalBillAmount || 0,
      totalInvestment: billStats[0]?.totalInvestment || 0,
      profit:
        (billStats[0]?.totalBillAmount || 0) -
        (billStats[0]?.totalInvestment || 0),
      totalPaymentIn: transactionStats[0]?.totalPaymentIn || 0,
      totalPaymentOut: transactionStats[0]?.totalPaymentOut || 0,
      peakHour: "N/A",
    };


    if (peakHourAgg.length > 0) {
      const hour = peakHourAgg[0]._id;
      const startHour = moment().hour(hour).minute(0).format("hh A");
      const endHour = moment().hour(hour + 1).minute(0).format("hh A");
      result.peakHour = `${startHour} - ${endHour}`;
    }

    return ApiResponse(res, 200, true, "Summary calculated", result);
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};
