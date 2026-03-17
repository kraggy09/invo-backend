import mongoose, { ClientSession } from "mongoose";
import Counter from "../models/counter.model";
import ApiResponse from "../utils/ApiResponse";
import { Request, Response } from "express";
import Customer from "../models/customer.model";
import Product from "../models/product.model";
import Logger from "../models/logger.model";
import Bill from "../models/bill.model";
import Transaction from "../models/transaction.model";
import moment from "moment-timezone";
import { ApiError } from "../utils";
import { EVENTS_MAP } from "../constant/redisMap";
import { addJourneyLog, addCustomerJourneyLog } from "../services/logger.service";
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
  } = req.body;

  const session: ClientSession = await mongoose.startSession();

  try {
    const result = await session.withTransaction(async () => {
      // Fetch latest counters in parallel
      const [previousBillId, previousTransactionId] = await Promise.all([
        Counter.findOne({ name: "billId" }),
        Counter.findOne({ name: "transactionId" }).session(session),
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

      const customer = await Customer.findById(customerId).session(session);
      if (!customer) throw new ApiError(404, "Customer not found");

      // Prepare product IDs and fetch all at once
      const productIds = products.map(
        (p: any) => new mongoose.Types.ObjectId(p.id)
      );
      const availableProducts = await Product.find(
        { _id: { $in: productIds } },
        { stock: 1, costPrice: 1, category: 1 } // only needed fields
      ).session(session);

      const notificationRules = await getNotificationRules(customerId);
      const matchingNotifications = new Map<string, { rule: any, items: any[] }>();

      const productMap = new Map<string, (typeof availableProducts)[0]>();
      availableProducts.forEach((prod: any) => {
        productMap.set(prod._id.toString(), prod);
      });

      let billTotal = 0;
      const items: any[] = [];
      const productBulkOps: any[] = [];

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

    await addJourneyLog(
      req,
      "BILL_CREATED",
      `Bill #${result.billId} created for ${result.updatedCustomer.name} with total ₹${result.bill.total}`,
      createdBy,
      "Bill",
      populatedBill._id,
      {
        itemsCount: populatedBill.items.length,
        paymentReceived: payment,
        items: populatedBill.items.map((i: any) => ({ product: i.product?.name || i.product, quantity: i.quantity, price: i.price }))
      }
    );

    await addCustomerJourneyLog(
      req,
      customerId,
      "BILL_CREATED",
      `Bill #${result.billId} created for ₹${result.bill.productsTotal} ${payment > 0 ? `with payment of ₹${payment}` : ""}`,
      createdBy,
      result.bill.productsTotal,
      (result.bill.total - result.bill.productsTotal),
      result.updatedCustomer.outstanding,
      populatedBill._id,
      { paymentReceived: payment, itemsCount: populatedBill.items.length }
    );

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
  const { product, startDate, endDate } = req.body;

  const barcode = product.barcode.map((code: any) => parseInt(code));

  try {
    const startMoment = moment(startDate).startOf("day").tz(IST);
    const endMoment = moment(endDate).endOf("day").tz(IST);

    const result = await Bill.aggregate([
      {
        $match: {
          createdAt: { $gte: startMoment.toDate(), $lte: endMoment.toDate() },
        },
      },
      {
        $unwind: "$items",
      },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $unwind: "$productDetails",
      },
      {
        $match: {
          "productDetails.barcode": { $in: barcode },
        },
      },

      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "createdByDetails",
        },
      },
      {
        $lookup: {
          from: "customers",
          localField: "customer",
          foreignField: "_id",
          as: "customerDetails",
        },
      },
      {
        $addFields: {
          createdBy: { $arrayElemAt: ["$createdByDetails", 0] },
          customer: { $arrayElemAt: ["$customerDetails", 0] },
        },
      },
      {
        $group: {
          _id: "$_id",
          date: { $first: "$date" },
          createdAt: { $first: "$createdAt" },
          items: { $push: "$items" },
          expires: { $first: "$expires" },
          total: { $first: "$total" },
          payment: { $first: "$payment" },
          discount: { $first: "$discount" },
          createdBy: { $first: "$createdBy" },
          customer: { $first: "$customer" },
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
    ]);

    return ApiResponse(res, 200, true, "Recieved successfully", {
      bills: result,
    });
  } catch (error: any) {
    console.error(error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
}

export const getAllBillsInDateRange = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, offset = 0, limit = 10 } = req.query;

    if (!startDate || !endDate) {
      return ApiResponse(
        res,
        400,
        false,
        "Both startDate and endDate are required"
      );
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    // Check if the dates are valid
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return ApiResponse(res, 400, false, "Invalid date format");
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Pagination logic (offset, limit)
    const bills = await Bill.find({
      createdAt: {
        $gte: start,
        $lte: end,
      },
    })
      .populate("items.product")
      .populate("customer")
      .populate("createdBy", "name username");

    if (bills.length > 0) {
      return ApiResponse(res, 200, true, "Bills found", { bills });
    } else {
      return ApiResponse(
        res,
        200,
        true,
        "No bills found for the given date range",
        { bills: [] }
      );
    }
  } catch (error: any) {
    console.log(error, "This is the error you need to check");

    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};
