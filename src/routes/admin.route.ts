import express from "express";
import {
  addUserToCompany,
  getAllUsers,
  getAdminData,
} from "../controllers/admin.controller";
const adminRouter = express.Router();

adminRouter.route("/users").post(addUserToCompany as any).get(getAllUsers as any);
adminRouter.route("/dashboard").post(getAdminData as any);

export default adminRouter;
