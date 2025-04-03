import express from "express";
import {
  createBill,
  getAllBillsInDateRange,
  getBillDetails,
  getBillsByProductNameAndDate,
  getLatestBillId,
} from "../controllers/bill.controller";
const billRouter = express.Router();

billRouter.route("/createBill").post(createBill);
billRouter.route("/getBillDetails").get(getBillDetails);
billRouter.route("/getAllBills").get(getAllBillsInDateRange);
billRouter.route("/getLatestBillId").get(getLatestBillId);
billRouter.route("/getBillByProductName").get(getBillsByProductNameAndDate);

export default billRouter;
