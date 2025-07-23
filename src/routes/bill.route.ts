import express from "express";
import {
  createBill,
  getAllBillsInDateRange,
  getBillDetails,
  getBillsByProductNameAndDate,
  getLatestBillId,
} from "../controllers/bill.controller";
const billRouter = express.Router();

billRouter.route("/create-bill").post(createBill);
billRouter.route("/single-bill/:id").get(getBillDetails);
billRouter.route("/get-bills").get(getAllBillsInDateRange);
billRouter.route("/get-billing-id").get(getLatestBillId);
billRouter.route("/getBillByProductName").get(getBillsByProductNameAndDate);

export default billRouter;
