import express from "express";
import {
  approveTransaction,
  createNewPayment,
  createNewTransaction,
  getAllTransactions,
  getLatestTransactionId,
  rejectTransaction,
  getAllTransactionsInDateRange,
  getSingleTransaction
} from "../controllers/transaction.controller";
const transactionRouter = express.Router();

transactionRouter.route("/").post(createNewTransaction).get(getAllTransactionsInDateRange);
transactionRouter.route("/payments").post(createNewPayment);
transactionRouter.route("/approvals").get(getAllTransactions);
transactionRouter.route("/:id/approve").post(approveTransaction);
transactionRouter.route("/:id/reject").post(rejectTransaction);
transactionRouter.route("/latest-id").get(getLatestTransactionId);
transactionRouter.route("/:id").get(getSingleTransaction);

export default transactionRouter;
