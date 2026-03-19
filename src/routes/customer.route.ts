import express from "express";
import {
  createNewCustomer,
  getAllCustomers,
  getSingleCustomer,
  getCustomerAnalytics,
  getCustomerHistory,
  getCustomerBills,
  getCustomerTransactions,
  getCustomerReturns,
  getCustomerJourneys,
} from "../controllers/customer.controller";
import { isAllowed } from "../services/token.service";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";

const customerRouter = express.Router();

customerRouter.route("/").post(createNewCustomer).get(getAllCustomers);
customerRouter.route("/:id").get(getSingleCustomer);
customerRouter.route("/:id/analytics").get(isAllowed(["SUPER_ADMIN", "ADMIN", "CREATOR"]), getCustomerAnalytics);
customerRouter.route("/:id/history").get(isAllowed(["SUPER_ADMIN", "ADMIN", "CREATOR"]), getCustomerHistory);
customerRouter.route("/:id/bills").get(getCustomerBills);
customerRouter.route("/:id/transactions").get(getCustomerTransactions);
customerRouter.route("/:id/returns").get(getCustomerReturns);
customerRouter.route("/:id/journeys").get(isAllowed(["SUPER_ADMIN", "ADMIN", "CREATOR"]), getCustomerJourneys as any);

export default customerRouter;
