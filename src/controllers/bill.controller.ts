import mongoose, { ClientSession } from "mongoose";
import Counter from "../models/counter.model";
import ApiResponse from "../utils/ApiResponse";
import { Request, Response } from "express";
import Customer from "../models/customer.model";
import Product from "../models/product.model";
import Bill from "../models/bill.model";
import Transaction from "../models/transaction.model";
import ReturnBill from "../models/returnBill.model";
import moment from "moment-timezone";
import { ApiError, getCurrentDateAndTime } from "../utils";
import { EVENTS_MAP } from "../constant/redisMap";
import { journeyQueue } from "../queues/journeyQueue";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import { scopedMatch } from "../utils/scopedMatch";

import { getNotificationRules } from "./notification.controller";
import billEvents, { BILL_EVENTS } from "../events/bill.events";
const IST = "Asia/Kolkata"; // Update with the correct path

export const createBill = async (req: AuthenticatedRequest, res: Response) => {
  const shopId = req.shopId;
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
    const existingBill = await Bill.findOne({ shopId, idempotencyKey })
      .populate("customer")
      .populate("createdBy", "name username");

    if (existingBill) {
      const transaction = await Transaction.findOne({
        shopId,
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
    const productIds = products.map(
      (p: any) => new mongoose.Types.ObjectId(p.id),
    );

    const [
      previousBillId,
      previousTransactionId,
      customer,
      availableProducts,
      notificationRules,
    ] = await Promise.all([
      Counter.findOne({ shopId, name: "billId" }),
      Counter.findOne({ shopId, name: "transactionId" }),
      Customer.findOne({ _id: customerId, shopId }),
      Product.find(
        { _id: { $in: productIds }, shopId },
        { stock: 1, costPrice: 1, category: 1 },
      ),
      getNotificationRules(customerId, shopId),
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

      const matchingNotifications = new Map<
        string,
        { rule: any; items: any[] }
      >();

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
            `Product not found: ${productInput.name || productIdStr}`,
          );
        }

        billTotal += productInput.total;

        // Update stock
        productBulkOps.push({
          updateOne: {
            filter: { _id: product._id, shopId },
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
        const productCategory = (
          product.category || productInput.category
        )?.toLowerCase();
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
                quantity,
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

      // Increment Bill ID counter — SCOPED to this shop
      const newBillId = await Counter.findOneAndUpdate(
        { shopId, name: "billId" },
        { $inc: { value: 1 } },
        { new: true, session },
      );

      if (!newBillId) {
        throw new ApiError(500, "Error while generating new Bill ID");
      }

      // Create the bill with shopId
      const [newBill] = await Bill.create(
        [
          {
            shopId,
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
        { session },
      );

      if (!newBill) throw new ApiError(500, "Failed to create new bill");

      // Process payment transaction if applicable
      let transaction = null;
      let newTransactionCounter = null;

      if (payment > 0) {
        newTransactionCounter = await Counter.findOneAndUpdate(
          { shopId, name: "transactionId" },
          { $inc: { value: 1 } },
          { new: true, session },
        );

        if (!newTransactionCounter) {
          throw new ApiError(500, "Unable to get new transaction ID");
        }

        const [createdTransaction] = await Transaction.create(
          [
            {
              shopId,
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
          { session },
        );

        if (!createdTransaction) {
          throw new ApiError(400, "Transaction creation failed");
        }

        transaction = createdTransaction;
      }

      const updatedCustomer = await Customer.findOneAndUpdate(
        { _id: customerId, shopId },
        { outstanding: netTotal - payment },
        { new: true, session },
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
    const user = req.user;
    const populatedBill = {
      ...result.bill.toObject(),
      customer: result.updatedCustomer,
      createdBy: user
        ? { _id: user._id, name: user.name, username: user.username }
        : result.bill.createdBy,
    };

    // Notify with socket.io — SCOPED to this shop's room only
    const data = {
      ...result,
      bill: populatedBill,
      socketId: req.headers.socketid,
    };

    const io = req.app.get("io");
    io.to(`shop:${shopId}`).emit(EVENTS_MAP.BILL_CREATED, data);

    // Offload journeys/logging to background worker — includes shopId in payload
    journeyQueue.add("bill-created", {
      shopId: shopId!.toString(),
      journeyLog: {
        eventType: "BILL_CREATED",
        message: `Bill #${result.billId} created for ${result.updatedCustomer.name} with total ₹${result.bill.productsTotal}`,
        createdBy,
        entityType: "Bill",
        entityId: populatedBill._id,
        metadata: {
          itemsCount: populatedBill.items.length,
          paymentReceived: payment,
          items: populatedBill.items.map((i: any) => ({
            product: i.productSnapshot.name,
            quantity: i.quantity,
            price: i.price,
          })),
        },
      },
      customerJourneyLog: {
        shopId: shopId!.toString(),
        customerId,
        eventType: "BILL_CREATED",
        message: `Bill #${result.billId} created for ₹${result.bill.productsTotal} ${payment > 0 ? `with payment of ₹${payment}` : ""}`,
        createdBy,
        amount: result.bill.productsTotal,
        adjustments: result.bill.total - result.bill.productsTotal,
        outstanding: result.updatedCustomer.outstanding,
        billId: populatedBill._id,
        metadata: {
          paymentReceived: payment,
          itemsCount: populatedBill.items.length,
        },
      },
    });

    // Emit event for background processing (notifications, etc.)
    billEvents.emit(BILL_EVENTS.BILL_CREATED, {
      bill: populatedBill,
      shopId,
      matchingNotifications: (result as any).matchingNotifications,
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

export const getBillDetails = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const id = req.params.id as string;

    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    let bill: any;

    if (isObjectId) {
      bill = await Bill.findOne({ _id: id, shopId })
        .populate("items.product")
        .populate("customer")
        .populate("createdBy", "name username");
    } else {
      const numericId = Number(id);
      if (isNaN(numericId)) {
        return ApiResponse(res, 400, false, "Invalid bill ID format");
      }
      bill = await Bill.findOne({ shopId, id: numericId })
        .populate("items.product")
        .populate("customer")
        .populate("createdBy", "name username");
    }

    if (!bill) {
      return ApiResponse(res, 404, false, "Failed to get the data of the bill");
    }

    const existingReturns = await ReturnBill.find({
      shopId,
      originalBill: bill._id,
    })
      .populate("createdBy", "name username")
      .populate("rejectedBy", "name username")
      .populate("items.product", "name")
      .sort({ createdAt: -1 })
      .lean();

    const returnedQuantities: Record<string, number> = {};
    existingReturns
      .filter((rb: any) => rb.status !== "REJECTED")
      .forEach((rb: any) => {
        rb.items?.forEach((item: any) => {
          const pId = item.product?._id ? item.product._id.toString() : item.product?.toString();
          if (pId) {
            returnedQuantities[pId] = (returnedQuantities[pId] || 0) + item.quantityReturned;
          }
        });
      });

    const billObj = bill.toObject ? bill.toObject() : bill;
    billObj.items = (billObj.items || []).map((item: any) => {
      const pId = item.product?._id
        ? item.product._id.toString()
        : item.product?.toString();
      const returnedQty = (pId && returnedQuantities[pId]) || 0;
      const remainingQty = Math.max(0, (item.quantity || 0) - returnedQty);
      return {
        ...item,
        returnedQuantity: returnedQty,
        remainingQuantity: remainingQty,
        isFullyReturned: remainingQty === 0,
      };
    });

    return ApiResponse(res, 200, true, "Found the bills", {
      bill: billObj,
      returnedQuantities,
      existingReturns,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const searchBillsForReturn = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const {
      invoiceId,
      customerId,
      customerQuery,
      productId,
      productQuery,
      page = 1,
      limit = 20,
    } = req.query;

    const andConditions: any[] = [{ shopId }];

    // 1. Invoice ID filter
    if (invoiceId && String(invoiceId).trim()) {
      const invStr = String(invoiceId).trim();
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(invStr);
      const numId = Number(invStr);
      if (isObjectId) {
        andConditions.push({ _id: invStr });
      } else if (!isNaN(numId)) {
        andConditions.push({ id: numId });
      } else {
        return ApiResponse(res, 200, true, "Bills retrieved", {
          bills: [],
          total: 0,
          page: Number(page),
          limit: Number(limit),
        });
      }
    }

    // 2. Customer filter (either direct ID or text query)
    if (customerId && String(customerId).trim()) {
      andConditions.push({
        customer: new mongoose.Types.ObjectId(String(customerId).trim()),
      });
    } else if (customerQuery && String(customerQuery).trim()) {
      const cq = String(customerQuery).trim();
      const matchedCustomers = await Customer.find({
        shopId,
        $or: [
          { name: { $regex: cq, $options: "i" } },
          { phone: { $regex: cq, $options: "i" } },
        ],
      })
        .select("_id")
        .lean();
      const customerIds = matchedCustomers.map((c) => c._id);
      andConditions.push({ customer: { $in: customerIds } });
    }

    // 3. Product filter (either direct ID or text query e.g. "gold small")
    if (productId && String(productId).trim()) {
      const pId = new mongoose.Types.ObjectId(String(productId).trim());
      andConditions.push({ "items.product": pId });
    } else if (productQuery && String(productQuery).trim()) {
      const pq = String(productQuery).trim();
      const numBarcode = Number(pq);

      const productFilter: any = {
        shopId,
        $or: [
          { name: { $regex: pq, $options: "i" } },
          { category: { $regex: pq, $options: "i" } },
        ],
      };
      if (!isNaN(numBarcode)) {
        productFilter.$or.push({ barcode: numBarcode });
      }

      const matchedProducts = await Product.find(productFilter)
        .select("_id")
        .lean();
      const matchedProductIds = matchedProducts.map((p) => p._id);

      const productOrList: any[] = [
        { "items.productSnapshot.name": { $regex: pq, $options: "i" } },
      ];
      if (matchedProductIds.length > 0) {
        productOrList.push({ "items.product": { $in: matchedProductIds } });
      }
      andConditions.push({ $or: productOrList });
    }

    const matchQuery =
      andConditions.length > 1 ? { $and: andConditions } : andConditions[0];

    const skip = (Number(page) - 1) * Number(limit);
    const limitNum = Number(limit);

    const [bills, total] = await Promise.all([
      Bill.find(matchQuery)
        .populate("customer", "name phone outstanding")
        .populate("createdBy", "name username")
        .populate("items.product")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Bill.countDocuments(matchQuery),
    ]);

    // Attach return information for each bill
    const billIds = bills.map((b: any) => b._id);
    const existingReturns = await ReturnBill.find({
      shopId,
      originalBill: { $in: billIds },
      status: { $ne: "REJECTED" },
    })
      .select("originalBill items status id createdAt")
      .lean();

    const returnMap: Record<string, Record<string, number>> = {};
    existingReturns.forEach((rb: any) => {
      const bId = rb.originalBill.toString();
      if (!returnMap[bId]) returnMap[bId] = {};
      rb.items?.forEach((item: any) => {
        const pId = item.product?.toString();
        if (pId) {
          returnMap[bId][pId] =
            (returnMap[bId][pId] || 0) + item.quantityReturned;
        }
      });
    });

    const enhancedBills = bills.map((bill: any) => {
      const bId = bill._id.toString();
      const billReturns = returnMap[bId] || {};

      let totalItemsPurchased = 0;
      let totalItemsReturned = 0;

      const items = (bill.items || []).map((item: any) => {
        const pId = item.product?._id
          ? item.product._id.toString()
          : item.product?.toString();
        const returnedQty = (pId && billReturns[pId]) || 0;
        const remainingQty = Math.max(0, (item.quantity || 0) - returnedQty);

        totalItemsPurchased += item.quantity || 0;
        totalItemsReturned += returnedQty;

        return {
          ...item,
          returnedQuantity: returnedQty,
          remainingQuantity: remainingQty,
          isFullyReturned: remainingQty === 0,
        };
      });

      return {
        ...bill,
        items,
        returnedQuantities: billReturns,
        totalItemsPurchased,
        totalItemsReturned,
        isFullyReturned:
          totalItemsPurchased > 0 && totalItemsReturned >= totalItemsPurchased,
      };
    });

    return ApiResponse(res, 200, true, "Bills retrieved successfully", {
      bills: enhancedBills,
      total,
      page: Number(page),
      limit: limitNum,
    });
  } catch (error: any) {
    console.error("Error searching bills for return:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getLatestBillId = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const latestBill = await Counter.findOne({ shopId, name: "billId" });
    if (latestBill) {
      const billId = latestBill.value;
      return ApiResponse(res, 200, true, "Latest Bill id", { billId });
    }
    return ApiResponse(res, 200, true, "Latest Bill id", { billId: 0 });
  } catch (error: any) {
    console.error("Error retrieving latest bill:", error);
    return ApiResponse(res, 500, false, error.message || "Server error");
  }
};

export async function getBillsByProductNameAndDate(
  req: AuthenticatedRequest,
  res: Response,
) {
  const shopId = req.shopId!;
  const { product, startDate, endDate, page = 1, limit = 20 } = req.body;

  const barcode = product.barcode.map((code: any) => parseInt(code));

  try {
    const startMoment = moment(startDate).startOf("day").tz(IST);
    const endMoment = moment(endDate).endOf("day").tz(IST);
    const skip = (Number(page) - 1) * Number(limit);
    const limitNum = Number(limit);

    // Look up the exact product ID — scoped to this shop
    const matchingProducts = await mongoose
      .model("Product")
      .find({
        shopId,
        barcode: { $in: barcode },
      })
      .select("_id")
      .lean();
    const productIds = matchingProducts.map((p: any) => p._id);

    const matchQuery = {
      shopId,
      createdAt: { $gte: startMoment.toDate(), $lte: endMoment.toDate() },
      "items.product": { $in: productIds },
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
      Bill.countDocuments(matchQuery),
    ]);

    // Format the bills items array so it ONLY contains the matching products
    const bills = billsData.map((bill: any) => ({
      ...bill,
      items: bill.items.filter((item: any) =>
        productIds.some((pid: any) => String(pid) === String(item.product)),
      ),
    }));

    // 2) Compute the overall total quantity/revenue quickly without deep groupings
    const summaryAgg = await Bill.aggregate([
      scopedMatch(shopId, {
        createdAt: { $gte: startMoment.toDate(), $lte: endMoment.toDate() },
        "items.product": { $in: productIds },
      }),
      { $unwind: "$items" },
      { $match: { "items.product": { $in: productIds } } },
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: "$items.quantity" },
          totalRevenue: { $sum: "$items.total" },
        },
      },
    ]);

    const summary = {
      totalInstances,
      totalQuantity: summaryAgg[0]?.totalQuantity || 0,
      totalRevenue: summaryAgg[0]?.totalRevenue || 0,
    };

    return ApiResponse(res, 200, true, "Recieved successfully", {
      bills,
      total: totalInstances,
      summary,
      page: Number(page),
      limit: limitNum,
    });
  } catch (error: any) {
    console.error(error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
}

export const getAllBillsInDateRange = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const {
      startDate,
      endDate,
      page = 1,
      limit = 10,
      search,
      minAmount,
      maxAmount,
    } = req.query;

    if (!startDate || !endDate) {
      return ApiResponse(
        res,
        400,
        false,
        "Both startDate and endDate are required",
      );
    }

    const start = moment
      .tz(startDate as string, IST)
      .startOf("day")
      .toDate();
    const end = moment
      .tz(endDate as string, IST)
      .endOf("day")
      .toDate();

    const skip = (Number(page) - 1) * Number(limit);

    let matchQuery: any = {
      shopId,
      createdAt: {
        $gte: start,
        $lte: end,
      },
    };

    if (minAmount !== undefined || maxAmount !== undefined) {
      matchQuery.productsTotal = {};
      if (minAmount !== undefined)
        matchQuery.productsTotal.$gte = Number(minAmount);
      if (maxAmount !== undefined)
        matchQuery.productsTotal.$lte = Number(maxAmount);
    }

    if (search) {
      const searchStr = String(search).trim();
      const numSearch = Number(searchStr);

      const customerMatch = await Customer.find({
        shopId,
        $or: [
          { name: { $regex: searchStr, $options: "i" } },
          { phone: { $regex: searchStr, $options: "i" } },
        ],
      })
        .select("_id")
        .lean();

      const customerIds = customerMatch.map((c) => c._id);

      const orConditions: any[] = [{ customer: { $in: customerIds } }];

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

export const getBillsSummary = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return ApiResponse(
        res,
        400,
        false,
        "Both startDate and endDate are required",
      );
    }

    const start = moment
      .tz(startDate as string, IST)
      .startOf("day")
      .toDate();
    const end = moment
      .tz(endDate as string, IST)
      .endOf("day")
      .toDate();

    const [billStats, transactionStats, peakHourAgg] = await Promise.all([
      Bill.aggregate([
        scopedMatch(shopId, { createdAt: { $gte: start, $lte: end } }),
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
        scopedMatch(shopId, {
          createdAt: { $gte: start, $lte: end },
          approved: true,
        }),
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
                    $not: [
                      {
                        $or: [
                          { $eq: ["$paymentIn", true] },
                          {
                            $and: [
                              {
                                $eq: [{ $ifNull: ["$paymentIn", null] }, null],
                              },
                              { $eq: ["$taken", false] },
                            ],
                          },
                        ],
                      },
                    ],
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
        scopedMatch(shopId, { createdAt: { $gte: start, $lte: end } }),
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
      const endHour = moment()
        .hour(hour + 1)
        .minute(0)
        .format("hh A");
      result.peakHour = `${startHour} - ${endHour}`;
    }

    return ApiResponse(res, 200, true, "Summary calculated", result);
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export interface AlterEligibilityResult {
  canAlter: boolean;
  reason?: string;
  bill?: any;
  customer?: any;
  basePreviousOutstanding?: number;
}

export const checkEligibilityForAlter = async (
  shopId: mongoose.Types.ObjectId,
  billId: string,
  session?: ClientSession,
): Promise<AlterEligibilityResult> => {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(billId);
  if (!isObjectId && isNaN(Number(billId))) {
    return { canAlter: false, reason: "Invalid bill ID format" };
  }
  const billFilter = isObjectId
    ? { _id: billId, shopId }
    : { id: Number(billId), shopId };

  const billQuery = Bill.findOne(billFilter).populate("customer");
  if (session) billQuery.session(session);
  const bill = await billQuery;
  if (!bill) {
    return { canAlter: false, reason: "Bill not found" };
  }

  const customerId = (bill.customer as any)?._id || bill.customer;
  if (!customerId) {
    return { canAlter: false, reason: "No customer associated with this bill" };
  }

  // 1. Check if newer bill exists for this customer
  const newerBillQuery = Bill.findOne({
    shopId,
    customer: customerId,
    _id: { $ne: bill._id },
    createdAt: { $gt: bill.createdAt },
  });
  if (session) newerBillQuery.session(session);
  const newerBill = await newerBillQuery;
  if (newerBill) {
    return {
      canAlter: false,
      reason: `A newer bill (#${newerBill.id}) exists for this customer`,
      bill,
    };
  }

  // 2. Check if a return bill was created after this bill
  const newerReturnQuery = ReturnBill.findOne({
    shopId,
    customer: customerId,
    status: { $ne: "REJECTED" },
    createdAt: { $gt: bill.createdAt },
  });
  if (session) newerReturnQuery.session(session);
  const newerReturn = await newerReturnQuery;
  if (newerReturn) {
    return {
      canAlter: false,
      reason: `A return bill (#${newerReturn.id}) was recorded after this bill`,
      bill,
    };
  }

  // 3. Check if any transaction occurred after this bill (excluding checkout transaction if any)
  const newerTxQuery = Transaction.findOne({
    shopId,
    customer: customerId,
    createdAt: { $gt: new Date(bill.createdAt.getTime() + 1000) },
    ...(bill.idempotencyKey
      ? { idempotencyKey: { $ne: bill.idempotencyKey } }
      : {}),
  });
  if (session) newerTxQuery.session(session);
  const newerTx = await newerTxQuery;
  if (newerTx) {
    return {
      canAlter: false,
      reason: `A transaction (#${newerTx.id} - ${newerTx.purpose || "Payment"}) was recorded after this bill`,
      bill,
    };
  }

  // 4. Check customer outstanding match: customer.outstanding === (bill.total - bill.payment)
  const customerQuery = Customer.findOne({ _id: customerId, shopId });
  if (session) customerQuery.session(session);
  const customer = await customerQuery;
  if (!customer) {
    return { canAlter: false, reason: "Customer record not found", bill };
  }

  const expectedOutstanding = Math.round(
    (bill.total || 0) - (bill.payment || 0),
  );
  const actualOutstanding = Math.round(customer.outstanding || 0);

  if (Math.abs(expectedOutstanding - actualOutstanding) > 1) {
    return {
      canAlter: false,
      reason: `Customer outstanding (₹${actualOutstanding}) does not match bill outstanding balance (₹${expectedOutstanding})`,
      bill,
      customer,
    };
  }

  const basePreviousOutstanding =
    (bill.total || 0) - (bill.productsTotal || 0) + (bill.discount || 0);

  return {
    canAlter: true,
    bill,
    customer,
    basePreviousOutstanding,
  };
};

export const checkBillAlterEligibility = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const id = (
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    ) as string;
    const userRoles = req.shopMember?.roles || [];
    const isAdmin =
      userRoles.includes("ADMIN") || userRoles.includes("SUPER_ADMIN");

    if (!isAdmin) {
      return ApiResponse(
        res,
        403,
        false,
        "Only admins are authorized to alter bills",
        {
          canAlter: false,
          reason: "Admin privileges required to alter bills",
        },
      );
    }

    const eligibility = await checkEligibilityForAlter(shopId, id);
    if (!eligibility.canAlter) {
      return ApiResponse(res, 200, true, "Eligibility check completed", {
        canAlter: false,
        reason: eligibility.reason,
      });
    }

    return ApiResponse(res, 200, true, "Bill is eligible for alteration", {
      canAlter: true,
      basePreviousOutstanding: eligibility.basePreviousOutstanding,
      bill: eligibility.bill,
      customer: eligibility.customer,
    });
  } catch (error: any) {
    return ApiResponse(
      res,
      500,
      false,
      error.message || "Failed to check eligibility",
    );
  }
};

export const alterBill = async (req: AuthenticatedRequest, res: Response) => {
  const shopId = req.shopId!;
  const id = (
    Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  ) as string;
  const { products, discount } = req.body;
  const user = req.user;
  const userRoles = req.shopMember?.roles || [];
  const isAdmin =
    userRoles.includes("ADMIN") || userRoles.includes("SUPER_ADMIN");

  if (!isAdmin) {
    return ApiResponse(
      res,
      403,
      false,
      "Only admins are authorized to alter bills",
    );
  }

  if (!products || !Array.isArray(products) || products.length === 0) {
    return ApiResponse(
      res,
      400,
      false,
      "At least one product item is required",
    );
  }

  const session = await mongoose.startSession();

  try {
    const result = await session.withTransaction(async () => {
      // 1. Re-validate eligibility within transaction
      const eligibility = await checkEligibilityForAlter(shopId, id, session);
      if (!eligibility.canAlter || !eligibility.bill || !eligibility.customer) {
        throw new ApiError(400, eligibility.reason || "Bill cannot be altered");
      }

      const bill = eligibility.bill;
      const customer = eligibility.customer;
      const basePreviousOutstanding = eligibility.basePreviousOutstanding ?? 0;

      // 2. Map old stock quantities
      const stockDeltas = new Map<string, number>();
      for (const oldItem of bill.items) {
        const pidStr =
          (oldItem.product as any)?._id?.toString() ||
          oldItem.product?.toString();
        if (pidStr) {
          stockDeltas.set(
            pidStr,
            (stockDeltas.get(pidStr) || 0) + (oldItem.quantity || 0),
          );
        }
      }

      // 3. Validate new products and calculate new totals
      const productIds = products.map(
        (p: any) => new mongoose.Types.ObjectId(p.id),
      );
      const dbProducts = await Product.find({
        _id: { $in: productIds },
        shopId,
      }).session(session);
      const dbProductMap = new Map<string, any>();
      dbProducts.forEach((p: any) => dbProductMap.set(String(p._id), p));

      let newProductsTotal = 0;
      const newItems: any[] = [];

      for (const productInput of products) {
        const pidStr = productInput.id.toString();
        const dbProd = dbProductMap.get(pidStr);
        if (!dbProd) {
          throw new ApiError(
            404,
            `Product not found: ${productInput.name || pidStr}`,
          );
        }

        const quantity =
          (productInput.piece || 0) +
          (productInput.packet || 0) * (productInput.packetQuantity || 1) +
          (productInput.box || 0) * (productInput.boxQuantity || 1);

        if (quantity <= 0) {
          throw new ApiError(
            400,
            `Invalid quantity for product ${productInput.name || pidStr}`,
          );
        }

        newProductsTotal += productInput.total;
        stockDeltas.set(pidStr, (stockDeltas.get(pidStr) || 0) - quantity);

        newItems.push({
          costPrice: dbProd.costPrice || 0,
          previousQuantity: dbProd.stock,
          newQuantity: dbProd.stock + (stockDeltas.get(pidStr) || 0),
          productSnapshot: productInput,
          product: dbProd._id,
          quantity,
          discount: productInput.discount || 0,
          type: productInput.type || "RETAIL",
          total: productInput.total,
        });
      }

      // 4. Execute inventory stock updates in bulk
      const productBulkOps: any[] = [];
      for (const [prodIdStr, delta] of stockDeltas.entries()) {
        if (delta !== 0) {
          productBulkOps.push({
            updateOne: {
              filter: { _id: new mongoose.Types.ObjectId(prodIdStr), shopId },
              update: { $inc: { stock: delta } },
            },
          });
        }
      }
      if (productBulkOps.length > 0) {
        await Product.bulkWrite(productBulkOps, { session });
      }

      // 5. Calculate new financial totals
      const newDiscount =
        discount !== undefined ? discount : bill.discount || 0;
      const newBillTotal = Math.ceil(
        newProductsTotal + basePreviousOutstanding - newDiscount,
      );
      const newCustomerOutstanding = newBillTotal - (bill.payment || 0);

      // 6. Update Customer outstanding
      const updatedCustomer = await Customer.findOneAndUpdate(
        { _id: customer._id, shopId },
        { outstanding: newCustomerOutstanding },
        { new: true, session },
      );

      if (!updatedCustomer) {
        throw new ApiError(500, "Failed to update customer balance");
      }

      // 7. Update checkout transaction if checkout payment existed
      if (bill.payment > 0) {
        await Transaction.findOneAndUpdate(
          {
            shopId,
            customer: customer._id,
            amount: bill.payment,
            createdAt: {
              $gte: new Date(bill.createdAt.getTime() - 5000),
              $lte: new Date(bill.createdAt.getTime() + 5000),
            },
            ...(bill.idempotencyKey
              ? { idempotencyKey: bill.idempotencyKey }
              : {}),
          },
          {
            previousOutstanding: newBillTotal,
            newOutstanding: newCustomerOutstanding,
          },
          { session },
        );
      }

      const oldProductsTotal = bill.productsTotal;
      const oldTotal = bill.total;

      // 8. Update Bill document
      bill.items = newItems;
      bill.productsTotal = newProductsTotal;
      bill.discount = newDiscount;
      bill.total = newBillTotal;
      bill.alteredAt = moment.tz(getCurrentDateAndTime(), IST).toDate();
      bill.alteredBy = user?._id || user?.id;
      if (!bill.originalTotalBeforeAlter) {
        bill.originalTotalBeforeAlter = oldTotal;
      }
      if (!bill.alterHistory) {
        bill.alterHistory = [];
      }
      bill.alterHistory.push({
        alteredAt: new Date(),
        alteredBy: user?._id || user?.id,
        previousProductsTotal: oldProductsTotal,
        previousTotal: oldTotal,
        newProductsTotal,
        newTotal: newBillTotal,
      });

      await bill.save({ session });

      return {
        bill,
        customer: updatedCustomer,
        oldProductsTotal,
        oldTotal,
        newProductsTotal,
        newBillTotal,
        newCustomerOutstanding,
        stockDeltas: Array.from(stockDeltas.entries()).map(
          ([productId, delta]) => ({
            productId,
            delta,
          }),
        ),
      };
    });

    // Populate bill for client and socket broadcast
    const populatedBill = await Bill.findById(result.bill._id)
      .populate("customer")
      .populate("createdBy", "name username")
      .populate("alteredBy", "name username")
      .populate("items.product");

    // Socket.io updates to shop room
    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.BILL_UPDATED, {
        bill: populatedBill,
        customer: result.customer,
        updatedCustomer: result.customer,
        billId: result.bill.id,
        stockDeltas: result.stockDeltas,
        socketId: req.headers.socketid,
      });
      io.to(`shop:${shopId}`).emit(
        EVENTS_MAP.CUSTOMER_UPDATED,
        result.customer,
      );
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.STOCK_UPDATED, {
        source: "BILL_ALTERED",
        billId: result.bill._id,
      });
    }

    // BullMQ Journey Logging
    journeyQueue.add("bill-altered", {
      shopId: shopId.toString(),
      journeyLog: {
        eventType: "BILL_ALTERED",
        message: `Bill #${result.bill.id} altered for ${result.customer.name}: products total updated from ₹${result.oldProductsTotal} to ₹${result.newProductsTotal}`,
        createdBy: user?._id || user?.id,
        entityType: "Bill",
        entityId: result.bill._id,
        metadata: {
          billId: result.bill.id,
          oldProductsTotal: result.oldProductsTotal,
          newProductsTotal: result.newProductsTotal,
          oldTotal: result.oldTotal,
          newTotal: result.newBillTotal,
          itemsCount: result.bill.items.length,
        },
      },
      customerJourneyLog: {
        shopId: shopId.toString(),
        customerId: result.customer._id,
        eventType: "BILL_ALTERED",
        message: `Bill #${result.bill.id} altered by admin. Amount: ₹${result.oldProductsTotal} → ₹${result.newProductsTotal}. Outstanding: ₹${result.oldTotal - (result.bill.payment || 0)} → ₹${result.newCustomerOutstanding}`,
        createdBy: user?._id || user?.id,
        amount: result.newProductsTotal,
        adjustments: result.newBillTotal - result.newProductsTotal,
        outstanding: result.newCustomerOutstanding,
        billId: result.bill._id,
        metadata: {
          billId: result.bill.id,
          oldTotal: result.oldTotal,
          newTotal: result.newBillTotal,
          diff: result.newBillTotal - result.oldTotal,
        },
      },
    });

    return ApiResponse(res, 200, true, "Bill altered successfully", {
      bill: populatedBill,
      customer: result.customer,
    });
  } catch (error: any) {
    console.error("❌ Bill alteration error:", error);
    if (error instanceof ApiError) {
      return ApiResponse(res, error.statusCode, false, error.message);
    }
    return ApiResponse(res, 500, false, error.message || "Server Error");
  } finally {
    session.endSession();
  }
};
