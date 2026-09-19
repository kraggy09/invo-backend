import { Response } from "express";
import Category from "../models/category.model";
import ApiResponse from "../utils/ApiResponse";
import { journeyQueue } from "../queues/journeyQueue";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import { EVENTS_MAP } from "../constant/redisMap";
import Product from "../models/product.model";

export const createNewCategory = async (req: AuthenticatedRequest, res: Response) => {
  const shopId = req.shopId!;
  let { name, wholesale, superWholeSale } = req.body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return ApiResponse(res, 400, false, "Category name is required");
  }

  name = name.toLowerCase().trim();
  if (name === "null" || name === "nan" || name === "undefined") {
    return ApiResponse(res, 400, false, "Invalid category name");
  }

  wholesale = Number(wholesale);
  superWholeSale = Number(superWholeSale);

  try {
    // Uniqueness check SCOPED to this shop
    let category = await Category.findOne({ shopId, name });

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
        { shopId, name },
        { $set: { wholesale, superWholeSale } },
        { new: true }
      );

      journeyQueue.add("category-updated", {
        shopId: shopId.toString(),
        journeyLog: {
          eventType: "CATEGORY_UPDATED",
          message: `Category ${name} was updated`,
          createdBy: req.user?._id || null,
          entityType: "Category",
          entityId: updatedCategory?._id,
          metadata: { wholesale, superWholeSale }
        }
      });

      const io = req.app.get("io");
      if (io) {
        io.to(`shop:${shopId}`).emit(EVENTS_MAP.CATEGORY_UPDATED, updatedCategory);
      }

      return ApiResponse(res, 200, true, "Category updated successfully", {
        category: updatedCategory,
      });
    } else {
      const newCategory = await Category.create({
        shopId,
        name,
        wholesale,
        superWholeSale,
      });

      journeyQueue.add("category-created", {
        shopId: shopId.toString(),
        journeyLog: {
          eventType: "CATEGORY_CREATED",
          message: `Category ${name} was created`,
          createdBy: req.user?._id || null,
          entityType: "Category",
          entityId: newCategory._id,
          metadata: { wholesale, superWholeSale }
        }
      });

      const io = req.app.get("io");
      if (io) {
        io.to(`shop:${shopId}`).emit(EVENTS_MAP.CATEGORY_CREATED, newCategory);
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

export const getAllCategories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const categories = await Category.find({ shopId });

    return ApiResponse(res, 200, true, "Categories found", {
      categories: categories || [],
    });
  } catch (error: any) {
    console.error("Error retrieving categories:", error);
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};

export const updateCategory = async (req: AuthenticatedRequest, res: Response) => {
  const shopId = req.shopId!;
  const { id } = req.params;
  let { name, wholesale, superWholeSale } = req.body;

  try {
    const updateData: any = {};
    if (name) updateData.name = name.toLowerCase().trim();
    if (wholesale !== undefined) updateData.wholesale = Number(wholesale);
    if (superWholeSale !== undefined)
      updateData.superWholeSale = Number(superWholeSale);

    // IDOR prevention: must belong to this shop
    const updatedCategory = await Category.findOneAndUpdate(
      { _id: id, shopId },
      { $set: updateData },
      { new: true }
    );

    if (!updatedCategory) {
      return ApiResponse(res, 404, false, "Category not found");
    }

    journeyQueue.add("category-updated", {
      shopId: shopId.toString(),
      journeyLog: {
        eventType: "CATEGORY_UPDATED",
        message: `Category ${updatedCategory.name} was updated via ${req.user?.name}`,
        createdBy: req.user?._id || null,
        entityType: "Category",
        entityId: updatedCategory._id,
        metadata: updateData
      }
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.CATEGORY_UPDATED, updatedCategory);
    }

    return ApiResponse(res, 200, true, "Category updated successfully", {
      category: updatedCategory,
    });
  } catch (error: any) {
    console.error("Error updating category:", error);
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};

export const deleteCategory = async (req: AuthenticatedRequest, res: Response) => {
  const shopId = req.shopId!;
  const { id } = req.params;

  try {
    // IDOR prevention: must belong to this shop
    const category = await Category.findOne({ _id: id, shopId });

    if (!category) {
      return ApiResponse(res, 404, false, "Category not found");
    }

    // Check products scoped to this shop
    const products = await Product.find({ shopId, category: category.name });

    if (products.length > 0) {
      return ApiResponse(
        res,
        400,
        false,
        "Cannot delete category as it is being used by products. Please change the category of these products to null first.",
        { products }
      );
    }

    await Category.findOneAndDelete({ _id: id, shopId });

    journeyQueue.add("category-deleted", {
      shopId: shopId.toString(),
      journeyLog: {
        eventType: "CATEGORY_DELETED",
        message: `Category ${category.name} was deleted`,
        createdBy: req.user?._id || null,
        entityType: "Category",
        entityId: category._id
      }
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.CATEGORY_DELETED, category._id);
    }

    return ApiResponse(res, 200, true, "Category deleted successfully");
  } catch (error: any) {
    console.error("Error deleting category:", error);
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};
