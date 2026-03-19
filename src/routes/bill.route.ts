import express from "express";
import {
  createBill,
  getAllBillsInDateRange,
  getBillDetails,
  getBillsByProductNameAndDate,
  getBillsSummary,
  getLatestBillId,
} from "../controllers/bill.controller";
const billRouter = express.Router();

billRouter.route("/").post(createBill).get(getAllBillsInDateRange);
billRouter.route("/summary").get(getBillsSummary);
billRouter.route("/latest-id").get(getLatestBillId);
billRouter.route("/search-by-product").post(getBillsByProductNameAndDate);
billRouter.route("/:id").get(getBillDetails);

export default billRouter;
