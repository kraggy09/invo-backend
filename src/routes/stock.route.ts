import express from "express";
import {
  acceptAllInventoryRequest,
  getInventoryUpdateRequest,
  rejectInventoryRequest,
  updateInventoryRequest,
  getAllRequests,
} from "../controllers/stock.controller";
import { isAllowed } from "../services/token.service";

const stockRouter = express.Router();

stockRouter.route("/requests").get(getInventoryUpdateRequest).post(updateInventoryRequest);
stockRouter.route("/requests/accept-all").post(isAllowed(["SUPER_ADMIN", "ADMIN", "CREATOR"]), acceptAllInventoryRequest);
stockRouter.route("/requests/all").get(getAllRequests);
stockRouter.route("/requests/:id/reject").get(isAllowed(["SUPER_ADMIN", "ADMIN", "CREATOR"]), rejectInventoryRequest);

export default stockRouter;
