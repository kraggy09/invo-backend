import express from "express";
import {
  createBill,
  getAllBillsInDateRange,
  getBillDetails,
  getBillsByProductNameAndDate,
  getBillsSummary,
  getLatestBillId,
  checkBillAlterEligibility,
  alterBill,
  searchBillsForReturn,
} from "../controllers/bill.controller";
import { isAllowed } from "../services/token.service";
const billRouter = express.Router();

billRouter.route("/").post(createBill).get(getAllBillsInDateRange);
billRouter.route("/summary").get(getBillsSummary);
billRouter.route("/latest-id").get(getLatestBillId);
billRouter.route("/search-by-product").post(getBillsByProductNameAndDate);
billRouter.route("/search-for-return").get(searchBillsForReturn);
billRouter.route("/:id/alter-eligibility").get(checkBillAlterEligibility as any);
billRouter.route("/:id/alter").put(isAllowed(["SUPER_ADMIN", "ADMIN"]), alterBill as any);
billRouter.route("/:id").get(getBillDetails);

export default billRouter;
