import express from "express";
import {
  createNewCustomer,
  getAllCustomers,
  getSingleCustomer,
} from "../controllers/customer.controller";

const customerRouter = express.Router();

customerRouter.route("/newCustomer").post(createNewCustomer);
customerRouter.route("/getAllCustomers").get(getAllCustomers);
customerRouter.route("/getCustomer/:customerId").get(getSingleCustomer);

export default customerRouter;
