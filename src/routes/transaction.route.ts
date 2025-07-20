import express from "express";
import {
  approveTransaction,
  createNewPayment,
  createNewTransaction,
  getAllTransactions,
  getLatestTransactionId,
  rejectTransaction,
  getAllTransactionsInDateRange,
} from "../controllers/transaction.controller";
const transactionRouter = express.Router();

transactionRouter.route("/createTransation").post(createNewTransaction);
transactionRouter.route("/createPayment").post(createNewPayment);
transactionRouter.route("/getTransactionForApproval").get(getAllTransactions);
transactionRouter.route("/approveTransaction").post(approveTransaction);
transactionRouter.route("/rejectTransaction").post(rejectTransaction);
transactionRouter.route("/get-transaction-id").get(getLatestTransactionId);
transactionRouter.route("/get-transactions").get(getAllTransactionsInDateRange);

export default transactionRouter;
