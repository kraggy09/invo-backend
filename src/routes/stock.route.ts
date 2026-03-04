import express from "express";
import {
  acceptAllInventoryRequest,
  getInventoryUpdateRequest,
  rejectInventoryRequest,
  updateInventoryRequest,
  getAllRequests,
} from "../controllers/stock.controller";

const stockRouter = express.Router();

stockRouter.route("/requests").get(getInventoryUpdateRequest).post(updateInventoryRequest);
stockRouter.route("/requests/accept-all").post(acceptAllInventoryRequest);
stockRouter.route("/requests/all").get(getAllRequests);
stockRouter.route("/requests/:id/reject").get(rejectInventoryRequest);

export default stockRouter;
