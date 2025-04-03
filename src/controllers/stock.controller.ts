import { Request, Response } from "express";
import mongoose from "mongoose";
import Product from "../models/product.model";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import Stock from "../models/stock.model";
import ApiResponse from "../utils/ApiResponse";
import { ApiError, getDate, getServerErrorLog } from "../utils";

import Logger from "../models/logger.model";

export const updateInventoryRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const products = req.body;
  const userId = req.user?.id;
  const session = await mongoose.startSession();

  try {
    const result = await session.withTransaction(async () => {
      const updateProductsData = [];

      for (const productData of products.update) {
        const itemId = productData._id;

        // Find the existing product
        const existingProduct = await Product.findById(itemId).session(session);
        if (!existingProduct) {
          throw new ApiError(404, `Product not found for ${itemId}`);
        }

        // Prepare data for the `UpdateProducts` collection
        updateProductsData.push({
          createdBy: userId,
          approved: false,
          product: existingProduct._id,
          oldStock: productData.stock,
          quantity: productData.quantity,
          purpose: "STOCK_UPDATE",
        });
      }

      // Insert the update logs in bulk
      const createdItems = await Stock.insertMany(updateProductsData, {
        session,
      });

      return createdItems;
    });

    // Success response
    return ApiResponse(res, 201, true, "Sent for verification to admin", {
      data: result,
    });
  } catch (error: any) {
    return getServerErrorLog(res, error);
  } finally {
    // Ensure the session ends
    session.endSession();
  }
};

export const getInventoryUpdateRequest = async (
  req: Request,
  res: Response
) => {
  try {
    const inventory = await Stock.find().populate("product");
    if (inventory) {
      return ApiResponse(
        res,
        200,
        true,
        "These are the requests that are needed to update"
      );
    } else {
      return ApiResponse(
        res,
        404,
        false,
        "No inventory requests are found in this"
      );
    }
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const rejectInventoryRequest = async (req: Request, res: Response) => {
  const { stockId } = req.body;
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const product = await Stock.findOneAndDelete({
        _id: stockId,
      }).session(session);

      if (!product) {
        throw new ApiError(404, "Product not found");
      }

      return product; // Returning the deleted product for response
    });

    // Success response
    return ApiResponse(res, 200, true, "Request rejected successfully");
  } catch (error: any) {
    return getServerErrorLog(res, error);
  } finally {
    session.endSession();
  }
};

export const acceptInventoryRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { requestId } = req.body;
  const session = await mongoose.startSession();
  const userId = req.user?.id;

  try {
    await session.withTransaction(async () => {
      const stockUpdateRequest = await Stock.findById(requestId).session(
        session
      );
      if (!stockUpdateRequest) {
        throw new ApiError(404, "Unable to find the request");
      }
      const productId = stockUpdateRequest.product._id;
      const availableProduct = await Product.findById(productId).session(
        session
      );
      if (!availableProduct) {
        throw new ApiError(404, "Product not found");
      }

      // Update the product's stock within the session
      const updatedProduct = await Product.findByIdAndUpdate(
        productId,
        { $inc: { stock: stockUpdateRequest.quantity } },
        { new: true, session }
      );
      if (!updatedProduct) {
        throw new ApiError(
          400,
          "Unable to update the product!! Please try again"
        );
      }
      stockUpdateRequest.stockAtUpdate = availableProduct.stock;
      stockUpdateRequest.newStock = updatedProduct.stock;
      stockUpdateRequest.approved = true;
      stockUpdateRequest.approvedBy = userId;
      await stockUpdateRequest.save({ session });

      await Logger.create(
        [
          {
            name: "STOCK_UPDATE",
            previousQuantity: availableProduct.stock,
            newQuantity: updatedProduct.stock,
            product: availableProduct._id,
            quantity: stockUpdateRequest.quantity,
          },
        ],
        { session }
      );
    });

    return ApiResponse(res, 200, true, "Stock Updated successfully");
  } catch (error: any) {
    return getServerErrorLog(res, error);
  } finally {
    session.endSession();
  }
};

export const acceptAllInventoryRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const session = await mongoose.startSession();
  const userId = req.user?.id;
  const requests = req.body.inventoryRequests;

  try {
    await session.withTransaction(async () => {
      const productBulkOps = [];
      const loggerEntries = [];
      const stockRequestsToUpdate = [];

      for (const id of requests) {
        const stockUpdateRequest = await Stock.findById(id).session(session);
        if (!stockUpdateRequest) {
          throw new ApiError(404, `Unable to find request for ID: ${id}`);
        }

        const productId = stockUpdateRequest.product._id;
        const availableProduct = await Product.findById(productId).session(
          session
        );
        if (!availableProduct) {
          throw new ApiError(404, `Product not found: ${productId}`);
        }

        // Prepare product stock update operation
        productBulkOps.push({
          updateOne: {
            filter: { _id: productId },
            update: { $inc: { stock: stockUpdateRequest.quantity } },
          },
        });

        // Prepare logger entry
        loggerEntries.push({
          name: "STOCK_UPDATE",
          previousQuantity: availableProduct.stock,
          newQuantity: availableProduct.stock + stockUpdateRequest.quantity,
          quantity: stockUpdateRequest.quantity,
          product: availableProduct._id,
        });

        // Collect stock requests to update
        stockUpdateRequest.stockAtUpdate = availableProduct.stock;
        stockUpdateRequest.newStock =
          availableProduct.stock + stockUpdateRequest.quantity;
        stockUpdateRequest.approved = true;
        stockUpdateRequest.approvedBy = userId;
        stockRequestsToUpdate.push(stockUpdateRequest);
      }

      // Execute bulk update for products
      if (productBulkOps.length > 0) {
        await Product.bulkWrite(productBulkOps, { session });
      }

      // Insert logger entries in bulk
      if (loggerEntries.length > 0) {
        await Logger.insertMany(loggerEntries, { session });
      }

      // Save all stock requests at once
      if (stockRequestsToUpdate.length > 0) {
        await Stock.bulkSave(stockRequestsToUpdate, { session });
      }
    });

    return ApiResponse(res, 200, true, "All stock updates successful");
  } catch (error: any) {
    return getServerErrorLog(res, error);
  } finally {
    session.endSession();
  }
};
