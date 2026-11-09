import express from "express";
import {
  addUserToCompany,
  getAllUsers,
  getAdminData,
  getAllAclRoles,
  assignRoleToUser,
  deleteUser,
} from "../controllers/admin.controller";
import { updateCustomer } from "../controllers/customer.controller";
import { isAllowed } from "../services/token.service";

const adminRouter = express.Router();

const adminRoles = ["PLATFORM_ADMIN", "SUPER_ADMIN", "ADMIN", "CREATOR"];

adminRouter
  .route("/users")
  .post(isAllowed(adminRoles), addUserToCompany as any)
  .get(isAllowed(adminRoles), getAllUsers as any);

adminRouter
  .route("/users/:userId")
  .delete(isAllowed(adminRoles), deleteUser as any);

adminRouter
  .route("/dashboard")
  .post(isAllowed(adminRoles), getAdminData as any);

adminRouter
  .route("/acls")
  .get(isAllowed(adminRoles), getAllAclRoles as any);

adminRouter
  .route("/assign-role")
  .post(isAllowed(adminRoles), assignRoleToUser as any);

adminRouter
  .route("/customers/:id")
  .put(isAllowed(["SUPER_ADMIN", "ADMIN", "CREATOR"]), updateCustomer as any)
  .patch(isAllowed(["SUPER_ADMIN", "ADMIN", "CREATOR"]), updateCustomer as any);

export default adminRouter;
