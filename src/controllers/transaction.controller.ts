import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import Counter from "../models/counter.model";
import ApiResponse from "../utils/ApiResponse";
import Transaction from "../models/transaction.model";
import { ApiError, getAclOfAUser } from "../utils";
import Customer from "../models/customer.model";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";

export const createNewTransaction = async (req: Request, res: Response) => {
  const { name, amount, purpose, transactionId } = req.body;
  const session = await mongoose.startSession();

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

    session.endSession();

    return ApiResponse(res, 201, true, "Transaction added successfully", {
      transaction: result,
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

    session.endSession();

    return ApiResponse(res, 201, true, "Payment recieved sucessfully", {
      payment: result,
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
  const { transactionId } = req.params;

  try {
    await session.withTransaction(async () => {
      const aclNames = await getAclOfAUser(userId as string);

      if (!aclNames.includes("TRANSACTION_RIGHTS")) {
        return ApiResponse(
          res,
          401,
          false,
          "You are not authorised to approve or reject transaction"
        );
      }

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
      await transaction.save({ session });
    });

    // Success response

    return ApiResponse(res, 200, true, "Transaction approved successfully", {
      customer,
      transaction,
    });
  } catch (error: any) {
    if (error instanceof ApiError) {
      return ApiResponse(res, error.statusCode, false, error.message, {
        error: error.data,
      });
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
  let { transactionId } = req.params;
  const userId = req.user?.id;

  try {
    transactionId = transactionId;
    const aclUsers = await getAclOfAUser(userId);

    if (!aclUsers.includes("TRANSACTION_RIGHTS")) {
      return ApiResponse(res, 401, false, "Unauthorised access for this");
    }
    let transaction = await Transaction.findByIdAndDelete(transactionId);
    if (!transaction) {
      throw new Error("Transaction not found");
    }
    return ApiResponse(res, 200, true, "Transaction deleted successfully");
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getAllTransactions = async (req: Request, res: Response) => {
  try {
    // Fetch transactions with approved set to false
    const transactions = await Transaction.find({ approved: false });

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
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return ApiResponse(
      res,
      400,
      false,
      "Please provide both startDate and endDate"
    );
  }
  try {
    const transactions = await Transaction.find({
      createdAt: {
        $gte: startDate,
        $lte: endDate,
      },
    });

    if (transactions.length === 0) {
      return ApiResponse(
        res,
        200,
        true,
        "No transactions found in this range",
        { transactions: [] }
      );
    }

    return ApiResponse(res, 200, true, "Transactions found successfully", {
      transactions,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};
