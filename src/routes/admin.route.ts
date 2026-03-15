import express from "express";
import {
  addUserToCompany,
  getAllUsers,
  getAdminData,
  getAllAclRoles,
} from "../controllers/admin.controller";
const adminRouter = express.Router();

adminRouter.route("/users").post(addUserToCompany as any).get(getAllUsers as any);
adminRouter.route("/dashboard").post(getAdminData as any);
adminRouter.route("/acls").get(getAllAclRoles as any);


export default adminRouter;
