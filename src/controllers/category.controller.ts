import { Request, Response } from "express";
import Category from "../models/category.model";
import ApiResponse from "../utils/ApiResponse";
import { journeyQueue } from "../queues/journeyQueue";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import { EVENTS_MAP } from "../constant/redisMap";
import Product from "../models/product.model";

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

      journeyQueue.add("category-updated", {
        journeyLog: {
          eventType: "CATEGORY_UPDATED",
          message: `Category ${name} was updated`,
          createdBy: (req as any).user?._id || null,
          entityType: "Category",
          entityId: updatedCategory?._id,
          metadata: { wholesale, superWholeSale }
        }
      });

      const io = req.app.get("io");
      if (io) {
        io.emit(EVENTS_MAP.CATEGORY_UPDATED, updatedCategory);
      }

      return ApiResponse(res, 200, true, "Category updated successfully", {
        category: updatedCategory,
      });
    } else {
      const newCategory = await Category.create({
        name,
        wholesale,
        superWholeSale,
      });

      journeyQueue.add("category-created", {
        journeyLog: {
          eventType: "CATEGORY_CREATED",
          message: `Category ${name} was created`,
          createdBy: (req as any).user?._id || null,
          entityType: "Category",
          entityId: newCategory._id,
          metadata: { wholesale, superWholeSale }
        }
      });

      const io = req.app.get("io");
      if (io) {
        io.emit(EVENTS_MAP.CATEGORY_CREATED, newCategory);
      }

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

export const updateCategory = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  let { name, wholesale, superWholeSale } = req.body;

  try {
    const updateData: any = {};
    if (name) updateData.name = name.toLowerCase().trim();
    if (wholesale !== undefined) updateData.wholesale = Number(wholesale);
    if (superWholeSale !== undefined)
      updateData.superWholeSale = Number(superWholeSale);

    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    );

    if (!updatedCategory) {
      return ApiResponse(res, 404, false, "Category not found");
    }

    journeyQueue.add("category-updated", {
      journeyLog: {
        eventType: "CATEGORY_UPDATED",
        message: `Category ${updatedCategory.name} was updated via ${req.user?.name}`,
        createdBy: (req as any).user?._id || null,
        entityType: "Category",
        entityId: updatedCategory._id,
        metadata: updateData
      }
    });

    const io = req.app.get("io");
    if (io) {
      io.emit(EVENTS_MAP.CATEGORY_UPDATED, updatedCategory);
    }

    return ApiResponse(res, 200, true, "Category updated successfully", {
      category: updatedCategory,
    });
  } catch (error: any) {
    console.error("Error updating category:", error);
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const category = await Category.findById(id);

    if (!category) {
      return ApiResponse(res, 404, false, "Category not found");
    }

    const products = await Product.find({ category: category.name });

    if (products.length > 0) {
      return ApiResponse(
        res,
        400,
        false,
        "Cannot delete category as it is being used by products. Please change the category of these products to null first.",
        { products }
      );
    }

    await Category.findByIdAndDelete(id);

    journeyQueue.add("category-deleted", {
      journeyLog: {
        eventType: "CATEGORY_DELETED",
        message: `Category ${category.name} was deleted`,
        createdBy: (req as any).user?._id || null,
        entityType: "Category",
        entityId: category._id
      }
    });

    const io = req.app.get("io");
    if (io) {
      io.emit(EVENTS_MAP.CATEGORY_DELETED, category._id);
    }

    return ApiResponse(res, 200, true, "Category deleted successfully");
  } catch (error: any) {
    console.error("Error deleting category:", error);
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};
