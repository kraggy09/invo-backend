import express from "express";
import {
  createNewCategory,
  getAllCategories,
} from "../controllers/category.controller";

const categoryRouter = express.Router();

categoryRouter.route("/newCategory").post(createNewCategory);
categoryRouter.route("/all-categories").get(getAllCategories);

export default categoryRouter;
