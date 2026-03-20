import express from "express";
import {
  createNewCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
} from "../controllers/category.controller";
import { isAllowed } from "../services/token.service";

const categoryRouter = express.Router();

const allowedRoles = ["SUPER_ADMIN", "ADMIN", "CREATOR"];

categoryRouter.get("/", getAllCategories);
categoryRouter.use(isAllowed(allowedRoles));
categoryRouter.route("/").post(createNewCategory);
categoryRouter.route("/:id").put(updateCategory).delete(deleteCategory);

export default categoryRouter;
