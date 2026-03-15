import express from "express";
import {
  addUserToCompany,
  getAllUsers,
  getAdminData,
  getAllAclRoles,
  assignRoleToUser,
  deleteUser,
} from "../controllers/admin.controller";
const adminRouter = express.Router();

adminRouter.route("/users").post(addUserToCompany as any).get(getAllUsers as any);
adminRouter.route("/users/:userId").delete(deleteUser as any);
adminRouter.route("/dashboard").post(getAdminData as any);
adminRouter.route("/acls").get(getAllAclRoles as any);
adminRouter.route("/assign-role").post(assignRoleToUser as any);


export default adminRouter;
