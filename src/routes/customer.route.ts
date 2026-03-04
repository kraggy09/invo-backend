import express from "express";
import {
  createNewCustomer,
  getAllCustomers,
  getSingleCustomer,
  getCustomerAnalytics,
} from "../controllers/customer.controller";

const customerRouter = express.Router();

customerRouter.route("/").post(createNewCustomer).get(getAllCustomers);
customerRouter.route("/:id").get(getSingleCustomer);
customerRouter.route("/:id/analytics").get(getCustomerAnalytics);

export default customerRouter;
