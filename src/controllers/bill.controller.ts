import mongoose from "mongoose";
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
import { pubClient } from "../config/redis.config";
import { EVENTS_MAP } from "../constant/redisMap";
const IST = "Asia/Kolkata"; // Update with the correct path

export const createBill = async (req: Request, res: Response) => {
  const products = req.body.purchased;
  const {
    customerId,
    billId,
    transactionId,
    payment = 0,
    paymentMode,
    discount = 0,
    createdBy,
  } = req.body;

  const session = await mongoose.startSession();

  try {
    const result = await session.withTransaction(async () => {
      const previousBillId = await Counter.findOne({ name: "billId" });
      const previousTransactionId = await Counter.findOne({
        name: "transactionId",
      }).session(session);

      if (!previousTransactionId || !previousBillId) {
        throw new ApiError(404, "Previous transactionid or bill id not found");
      }

      if (previousTransactionId.value != transactionId) {
        throw new ApiError(400, "Duplicate Transaction !! Pls refresh");
      }

      if (previousBillId.value != billId) {
        throw new ApiError(400, "Duplicate bill !! Pls refresh");
      }

      const customer = await Customer.findById(customerId).session(session);
      if (!customer) {
        throw new ApiError(404, "Customer not found");
      }

      let billTotal = 0;
      const items = [];
      const productBulkOperations = [];
      const loggerEntries = [];

      for (const product of products) {
        const quantity =
          product.piece +
          product.packet * product.packetQuantity +
          product.box * product.boxQuantity;
        billTotal += product.total;

        const id = new mongoose.Types.ObjectId(product.id);

        // Add product stock update operation to bulk array
        productBulkOperations.push({
          updateOne: {
            filter: { _id: id },
            update: { $inc: { stock: -quantity } },
          },
        });

        // Add logger entry
        const availableProduct = await Product.findById(id).session(session);
        if (!availableProduct) {
          throw new Error(`Product not found: ${product.name || product.id}`);
        }

        loggerEntries.push({
          name: "Billing",
          previousQuantity: availableProduct.stock,
          quantity: quantity,
          newQuantity: availableProduct.stock - quantity,
          product: availableProduct._id,
        });

        items.push({
          costPrice: availableProduct.costPrice,
          previousQuantity: availableProduct.stock,
          newQuantity: availableProduct.stock - quantity,
          product: availableProduct._id,
          quantity: quantity,
          discount: product.discount || 0,
          type: product.type,
          total: product.total,
        });
      }

      // Execute the bulk write operation for stock updates
      const bulkWriteResult = await Product.bulkWrite(productBulkOperations, {
        session,
      });

      if (bulkWriteResult.modifiedCount !== products.length) {
        throw new ApiError(401, "Failed to update all product stocks");
      }

      await Logger.insertMany(loggerEntries, { session });

      billTotal = Math.ceil(billTotal + customer.outstanding - discount);

      const newBillId = await Counter.findOneAndUpdate(
        { name: "billId" },
        { $inc: { value: 1 } },
        { new: true, session }
      );

      if (!newBillId) {
        throw new ApiError(403, "Error while creating bill id");
      }

      const newBill = await Bill.create(
        [
          {
            customer: customerId,
            items: items,
            total: billTotal,
            payment,
            discount,
            createdBy,
            id: newBillId.value,
          },
        ],
        { session }
      );

      if (!newBill[0]) {
        throw new ApiError(401, "Unable to create the bill");
      }

      let transaction = null;
      if (payment > 0) {
        let newTransId = await Counter.findOneAndUpdate(
          { name: "transactionId" },
          {
            $inc: { value: 1 },
          },
          { new: true, session }
        );
        if (!newTransId) {
          throw new ApiError(401, "Unbale to find the transaction id");
        }
        transaction = await Transaction.create(
          [
            {
              id: newTransId.value,
              name: customer.name,
              purpose: "Payment",
              amount: payment,
              previousOutstanding: billTotal,
              newOutstanding: billTotal - payment,
              taken: false,
              paymentMode,
              approved: true,
              customer: customer._id,
            },
          ],
          { session }
        );

        if (!transaction[0]) {
          throw new ApiError(400, "Unable to create the transaction");
        }
      }

      const updatedCustomer = await Customer.findByIdAndUpdate(
        customerId,
        {
          outstanding: billTotal - payment,
        },
        { session }
      );

      if (!updatedCustomer) {
        throw new ApiError(
          400,
          "Unable to update the customer's outstanding balance"
        );
      }

      return {
        bill: newBill[0],
        updatedCustomer,
        transaction,
      };
    });
    await pubClient.publish(EVENTS_MAP.BILL_CREATED, JSON.stringify(result));
    await pubClient.publish(
      EVENTS_MAP.BILL_CREATION_NOTIFICATION,
      JSON.stringify(result)
    );
    return ApiResponse(res, 201, true, "Bill created successfully", {
      bill: result,
    });
  } catch (error: any) {
    if (error instanceof ApiError) {
      return ApiResponse(res, error.statusCode, false, error.message);
    }
    return ApiResponse(res, 500, false, error.message || "Server error");
  } finally {
    session.endSession();
  }
};

export const getBillDetails = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const bill = await Bill.findById(id)
      .populate("items.product")
      .populate("customer");

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
      .skip(Number(offset)) // Skips the first 'offset' bills
      .limit(Number(limit)) // Limits the number of bills to 'limit'
      .populate("items.product");

    if (bills.length > 0) {
      return ApiResponse(res, 200, true, "Bills found", { bills });
    } else {
      return ApiResponse(
        res,
        404,
        false,
        "No bills found for the given date range"
      );
    }
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};
