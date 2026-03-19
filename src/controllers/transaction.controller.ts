import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import Counter from "../models/counter.model";
import ApiResponse from "../utils/ApiResponse";
import Transaction from "../models/transaction.model";
import { ApiError, getAclOfAUser, getCurrentDateAndTime } from "../utils";
import Customer from "../models/customer.model";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import { EVENTS_MAP } from "../constant/redisMap";
import moment from "moment-timezone";
import { addJourneyLog, addCustomerJourneyLog } from "../services/logger.service";

const IST = "Asia/Kolkata";

export const createNewTransaction = async (req: AuthenticatedRequest, res: Response) => {
  const { name, amount, purpose, transactionId } = req.body;
  const session = await mongoose.startSession();
  const user = req.user

  try {
    const result = await session.withTransaction(async () => {
      // Check if the transaction ID is valid
      const previousTransactionId = await Counter.findOne({
        name: "transactionId",
      }).session(session);

      if (!previousTransactionId) {
        return ApiResponse(
          res,
          400,
          false,
          "Previous transaction id not found"
        );
      }

      console.log(previousTransactionId.value, transactionId);
      if (previousTransactionId.value !== transactionId) {
        throw new Error("Duplicate transaction!! Please refresh.");
      }

      // Increment transaction ID
      const newTransactionId = await Counter.findOneAndUpdate(
        { name: "transactionId" },
        { $inc: { value: 1 } },
        { session, new: true }
      );

      if (!newTransactionId) {
        throw new Error("Error generating new transaction ID.");
      }

      // Create the new transaction
      const newTransaction = await Transaction.create(
        [
          {
            id: newTransactionId.value,
            name,
            amount,
            taken: true,
            purpose,
            approved: true,
            approvedAt: moment.tz(getCurrentDateAndTime(), IST).toDate(),
            approvedBy: user?._id || user?.id,
            paymentIn: false,
            paymentMode: "CASH",

          },
        ],
        { session }
      );

      if (!newTransaction || newTransaction.length === 0) {
        throw new Error("Error creating the transaction.");
      }

      return {
        newTransaction: newTransaction[0],
      };
    });

    const io = req.app.get("io");
    if (io && result && (result as any).newTransaction) {
      const transactionToEmit = (result as any).newTransaction;
      io.emit(EVENTS_MAP.TRANSACTION_CREATED, { transaction: transactionToEmit, transactionId: transactionToEmit.id });
    }

    await addJourneyLog(
      req,
      "TRANSACTION_CREATED",
      `Transaction #${(result as any)?.newTransaction?.id} of ₹${amount} created`,
      (req.user as any)?._id || (req.user as any)?.id,
      "Transaction",
      (result as any)?.newTransaction?._id,
      { amount, purpose, party: (result as any)?.newTransaction?.name }
    );

    await addCustomerJourneyLog(
      req,
      (result as any)?.newTransaction?.customer,
      "TRANSACTION_CREATED",
      `Transaction #${(result as any)?.newTransaction?.id} of ₹${amount} created`,
      (req.user as any)?._id || (req.user as any)?.id,
      amount,
      (result as any)?.newTransaction?.previousOutstanding || 0,
      (result as any)?.newTransaction?.newOutstanding || 0,
      (result as any)?.newTransaction?._id,
      { purpose, paymentIn: false, paymentMode: "CASH" }
    );

    session.endSession();

    return ApiResponse(res, 201, true, "Transaction added successfully", {
      transaction: result as any,
    });
  } catch (error: any) {
    console.error("Error:", error.message);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  } finally {
    session.endSession();
  }
};

export const createNewPayment = async (req: Request, res: Response) => {
  let { name, customerId, amount, paymentMode, transactionId } = req.body;
  const session = await mongoose.startSession();

  try {
    const result = await session.withTransaction(async () => {
      name = name.toLowerCase();
      customerId = new mongoose.Types.ObjectId(customerId);
      amount = Number(amount);

      const previousTransactionId = await Counter.findOne({
        name: "transactionId",
      }).session(session);

      if (!previousTransactionId) {
        return ApiResponse(
          res,
          400,
          false,
          "Unable to find the transaction Id"
        );
      }
      if (previousTransactionId.value !== transactionId) {
        throw new Error("Duplicate transaction!! Please refresh.");
      }

      // Fetch the customer
      const customer = await Customer.findById(customerId).session(session);
      if (!customer) {
        throw new Error("Customer not found");
      }

      const previousOutstanding = customer.outstanding;
      const newOutstanding = previousOutstanding - amount;

      let updatedTransactionId = await Counter.findOneAndUpdate(
        { name: "transactionId" },
        {
          $inc: { value: 1 },
        },
        {
          new: true,
          session,
        }
      );

      if (!updatedTransactionId) {
        throw new Error("Error while creating transaction id");
      }
      // Create the new transaction
      const newTransaction = await Transaction.create(
        [
          {
            id: updatedTransactionId.value,
            name,
            previousOutstanding,
            amount,
            newOutstanding,
            taken: false,
            purpose: "Payment",
            paymentMode,
            customer: customer._id,
            approved: false,
            paymentIn: true,
          },
        ],
        { session }
      );

      if (!newTransaction || newTransaction.length === 0) {
        throw new Error("Error creating the payment transaction.");
      }

      return {
        newTransaction: newTransaction[0],
      };
    });

    const io = req.app.get("io");
    if (io && result && (result as any).newTransaction) {
      const transactionToEmit = (result as any).newTransaction;
      io.emit(EVENTS_MAP.TRANSACTION_CREATED, { transaction: transactionToEmit, transactionId: transactionToEmit.id });
    }

    await addJourneyLog(
      req,
      "PAYMENT_CREATED",
      `Payment #${(result as any)?.newTransaction?.id} of ₹${amount} received`,
      (req as any).user?._id || null,
      "Transaction",
      (result as any)?.newTransaction?._id,
      { amount, paymentMode, party: (result as any)?.newTransaction?.name }
    );

    await addCustomerJourneyLog(
      req,
      customerId,
      "PAYMENT_CREATED",
      `Payment #${(result as any)?.newTransaction?.id} of ₹${amount} received`,
      (req as any).user?._id || null,
      amount,
      (result as any)?.newTransaction?.previousOutstanding,
      (result as any)?.newTransaction?.newOutstanding,
      (result as any)?.newTransaction?._id,
      { paymentMode, paymentIn: true }
    );

    session.endSession();

    return ApiResponse(res, 201, true, "Payment recieved sucessfully", {
      payment: result as any,
    });
  } catch (error: any) {
    console.error("Error:", error.message);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  } finally {
    session.endSession();
  }
};

export const approveTransaction = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const session = await mongoose.startSession();
  let customer, transaction;

  const userId = req.user?.id;
  const transactionId = req.params.id;

  console.log(transactionId, "This is the transactionID");

  try {
    await session.withTransaction(async () => {
      transaction = await Transaction.findById(transactionId).session(session);
      if (!transaction) {
        throw new Error("Transaction not found");
      }

      // Fetch the customer associated with the transaction
      customer = await Customer.findById(transaction.customer).session(session);
      if (!customer) {
        throw new Error("Customer not found");
      }

      // Validate outstanding balance
      if (customer.outstanding !== transaction.previousOutstanding) {
        throw new ApiError(
          400,
          "Outstanding balance does not match, please check",
          { customer, transaction }
        );
      }

      // Update customer's outstanding balance
      customer = await Customer.findByIdAndUpdate(
        transaction.customer,
        { $inc: { outstanding: -transaction.amount } },
        { new: true, session }
      );

      // Approve the transaction
      transaction.approved = true;
      transaction.approvedAt = moment.tz(getCurrentDateAndTime(), IST).toDate();
      transaction.approvedBy = userId;
      await transaction.save({ session });
    });

    const io = req.app.get("io");
    if (io) {
      io.emit(EVENTS_MAP.TRANSACTION_UPDATED, {
        transaction, customer, purpose: "ACCEPT"
      });
      // io.emit(EVENTS_MAP.CUSTOMER_UPDATED, customer);
    }

    await addJourneyLog(
      req,
      "TRANSACTION_APPROVED",
      `Transaction #${(transaction as any)?.id} was approved`,
      userId,
      "Transaction",
      (transaction as any)?._id,
      { amount: (transaction as any)?.amount }
    );

    await addCustomerJourneyLog(
      req,
      (transaction as any)?.customer,
      "TRANSACTION_APPROVED",
      `Transaction #${(transaction as any)?.id} of ₹${(transaction as any)?.amount} was approved`,
      userId,
      (transaction as any)?.amount,
      (transaction as any)?.previousOutstanding,
      (transaction as any)?.newOutstanding,
      (transaction as any)?._id,
      { paymentIn: (transaction as any)?.paymentIn }
    );

    // Success response

    return ApiResponse(res, 200, true, "Transaction approved successfully", {
      customer,
      transaction,
    });
  } catch (error: any) {
    console.log(error, "This is the error");

    if (error instanceof ApiError) {
      return ApiResponse(res, error.statusCode, false, error.message, error.data);
    }

    return ApiResponse(res, 500, false, error.message || "Server Error");
  } finally {
    // Ensure the session is ended
    session.endSession();
  }
};

export const rejectTransaction = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const userId = req.user?.id;
  const transactionId = req.params.id;

  try {
    // Changing from findByIdAndDelete to updating rejected status
    let transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      throw new Error("Transaction not found");
    }

    // Instead of deleting, just mark as rejected with timestamp
    transaction.rejectedAt = moment.tz(getCurrentDateAndTime(), IST).toDate();
    transaction.approvedBy = userId;
    await transaction.save();


    const io = req.app.get("io");
    if (io) {
      io.emit(EVENTS_MAP.TRANSACTION_UPDATED, {
        transaction, purpose: "REJECT"
      });
    }

    await addJourneyLog(
      req,
      "TRANSACTION_REJECTED",
      `Transaction #${(transaction as any)?.id} was rejected`,
      userId,
      "Transaction",
      (transaction as any)?._id,
      { amount: (transaction as any)?.amount }
    );

    await addCustomerJourneyLog(
      req,
      (transaction as any)?.customer,
      "TRANSACTION_REJECTED",
      `Transaction #${(transaction as any)?.id} of ₹${(transaction as any)?.amount} was rejected`,
      userId,
      (transaction as any)?.amount,
      (transaction as any)?.previousOutstanding,
      (transaction as any)?.previousOutstanding, // Remains same as previous
      (transaction as any)?._id,
      { paymentIn: (transaction as any)?.paymentIn }
    );
    return ApiResponse(res, 200, true, "Transaction deleted successfully");
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getAllTransactions = async (req: Request, res: Response) => {
  try {
    // Fetch transactions with approved set to false AND not rejected
    const transactions = await Transaction.find({
      approved: false,
      rejectedAt: { $exists: false }
    }).sort({
      createdAt: -1,
    });

    // Return successful response with the transactions
    return ApiResponse(res, 200, true, "Transactions found successfully", {
      transactions,
    });
  } catch (error: any) {
    return ApiResponse(
      res,
      500,
      false,
      "An error occurred while fetching transactions"
    );
  }
};

export const getLatestTransactionId = async (req: Request, res: Response) => {
  try {
    const latestTransactionId = await Counter.findOne({
      name: "transactionId",
    });

    if (latestTransactionId) {
      return ApiResponse(res, 200, true, "Latest Transaction Id", {
        transactionId: latestTransactionId.value,
      });
    }

    return ApiResponse(
      res,
      404,
      false,
      "Transaction Id not found, restart",
      {}
    );
  } catch (error: any) {
    console.error("Error retrieving latest Transaction:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getAllTransactionsInDateRange = async (
  req: Request,
  res: Response
) => {
  const { startDate, endDate, page = 1, limit = 10, paymentIn } = req.query;

  if (!startDate || !endDate) {
    return ApiResponse(
      res,
      400,
      false,
      "Please provide both startDate and endDate"
    );
  }
  try {
    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return ApiResponse(res, 400, false, "Invalid date format");
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const query: any = {
      createdAt: {
        $gte: start,
        $lte: end,
      },
      approved: true,
    };

    if (paymentIn !== undefined) {
      query.paymentIn = paymentIn === "true";
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .populate("customer", "name phone")
        .populate("approvedBy", "name username")
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Transaction.countDocuments(query),
    ]);

    return ApiResponse(res, 200, true, "Transactions found successfully", {
      transactions,
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getTransactionsSummary = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return ApiResponse(
        res,
        400,
        false,
        "Please provide both startDate and endDate"
      );
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return ApiResponse(res, 400, false, "Invalid date format");
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const transactionStats = await Transaction.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          approved: true,
        },
      },
      {
        $group: {
          _id: "$paymentIn",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const result = {
      totalPaymentIn: 0,
      totalPaymentOut: 0,
      paymentInCount: 0,
      paymentOutCount: 0,
    };

    transactionStats.forEach((t) => {
      if (t._id === true) {
        result.totalPaymentIn = t.totalAmount;
        result.paymentInCount = t.count;
      } else {
        result.totalPaymentOut = t.totalAmount;
        result.paymentOutCount = t.count;
      }
    });

    return ApiResponse(res, 200, true, "Transactions summary calculated", result);
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getSingleTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const transaction = await Transaction.findById(id)
      .populate("approvedBy", "name username")
      .populate("customer", "name phone");
    if (!transaction) {
      return ApiResponse(res, 404, false, "Transaction not found");
    }
    return ApiResponse(res, 200, true, "Transaction found", { transaction });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};
