import express from "express";
import {
  createNewCustomer,
  getAllCustomers,
  getSingleCustomer,
} from "../controllers/customer.controller";

const customerRouter = express.Router();

customerRouter.route("/newCustomer").post(createNewCustomer);
customerRouter.route("/get-customers").get(getAllCustomers);
customerRouter.route("/get-customer/:customerId").get(getSingleCustomer);

export default customerRouter;
