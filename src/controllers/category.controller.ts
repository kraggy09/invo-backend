import { Request, Response } from "express";
import Category from "../models/category.model";
import ApiResponse from "../utils/ApiResponse";
import { addJourneyLog } from "../services/logger.service";

export const createNewCategory = async (req: Request, res: Response) => {
  let { name, wholesale, superWholeSale } = req.body;

  name = name.toLowerCase().trim();
  wholesale = Number(wholesale);
  superWholeSale = Number(superWholeSale);

  try {
    let category = await Category.findOne({ name });

    if (category) {
      if (
        category.wholesale === wholesale &&
        category.superWholeSale === superWholeSale
      ) {
        return ApiResponse(
          res,
          409,
          true,
          "Category already exists with the same details"
        );
      }

      const updatedCategory = await Category.findOneAndUpdate(
        { name },
        { $set: { wholesale, superWholeSale } },
        { new: true } // Return the updated document
      );

      await addJourneyLog(
        req,
        "CATEGORY_UPDATED",
        `Category ${name} was updated`,
        (req as any).user?._id || null,
        "Category",
        updatedCategory?._id,
        { wholesale, superWholeSale }
      );

      return ApiResponse(res, 200, true, "Category updated successfully", {
        category: updatedCategory,
      });
    } else {
      const newCategory = await Category.create({
        name,
        wholesale,
        superWholeSale,
      });

      await addJourneyLog(
        req,
        "CATEGORY_CREATED",
        `Category ${name} was created`,
        (req as any).user?._id || null,
        "Category",
        newCategory._id,
        { wholesale, superWholeSale }
      );

      return ApiResponse(res, 200, true, "New category created successfully", {
        category: newCategory,
      });
    }
  } catch (error: any) {
    console.error("Error creating/updating category:", error);
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};

export const getAllCategories = async (_: Request, res: Response) => {
  try {
    const categories = await Category.find();

    if (!categories || categories.length === 0) {
      return ApiResponse(res, 404, false, "No categories found");
    }

    return ApiResponse(res, 200, true, "Categories found", { categories });
  } catch (error: any) {
    console.error("Error retrieving categories:", error);
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};
