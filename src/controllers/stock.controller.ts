import { Request, Response } from "express";
import mongoose from "mongoose";
import Product from "../models/product.model";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import Stock from "../models/stock.model";
import ApiResponse from "../utils/ApiResponse";
import { ApiError, getDate, getServerErrorLog } from "../utils";

import Logger from "../models/logger.model";

export const getAllRequests = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return ApiResponse(
        res,
        400,
        false,
        "Both startDate and endDate are required"
      );
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    // Check if the dates are valid
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return ApiResponse(res, 400, false, "Invalid date format");
    }

    // Adjust to full day range in IST (assuming dates are in IST)
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Fetch all requests in the date range
    const requests = await Stock.find({
      date: {
        $gte: start,
        $lte: end,
      },
    })
      .populate([
        { path: "product", select: "name stock" }, // Populate product details (adjust fields as needed)
        { path: "createdBy", select: "name username" }, // Populate creator
        { path: "actionBy", select: "name username" }, // Populate approver/rejector if any
      ])
      .sort({ date: -1 }) // Newest first
      .lean() // Faster: plain JS objects
      .exec();

    if (requests.length > 0) {
      return ApiResponse(res, 200, true, "Requests found", { requests });
    } else {
      return ApiResponse(
        res,
        200,
        true,
        "No requests found for the given date range",
        { requests: [] }
      );
    }
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};

export const getInventoryRequestForDate = async (
  req: AuthenticatedRequest,
  res: Response
) => {};
export const updateInventoryRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { products } = req.body;
  const userId = req.user?.id;
  const session = await mongoose.startSession();

  if (!Array.isArray(products) || products.length === 0) {
    session.endSession();
    throw new ApiError(400, "Invalid or empty products array");
  }

  const productIds = products.map((p) => p.id);
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.length !== productIds.length) {
    session.endSession();
    throw new ApiError(400, "Duplicate product IDs in payload");
  }

  try {
    const result = await session.withTransaction(async () => {
      // Bulk fetch all products in ONE query (minimizes DB calls)
      const existingProducts = await Product.find({ _id: { $in: uniqueIds } })
        .select("_id stock") // Only fetch needed fields
        .lean() // Faster: plain JS objects
        .session(session)
        .exec();

      // Create a map for O(1) lookups
      const productMap = new Map(
        existingProducts.map((p) => [p._id.toString(), p])
      );

      // Validate all products exist (early abort if any missing)
      const missingIds = uniqueIds.filter((id) => !productMap.has(id));
      if (missingIds.length > 0) {
        throw new ApiError(404, `Products not found: ${missingIds.join(", ")}`);
      }

      // Prepare bulk insert data
      const updateProductsData = products.map((productData) => {
        const existingProduct = productMap.get(productData.id);
        // Since we checked for missing IDs earlier, existingProduct should never be undefined.
        // Use non-null assertion to satisfy TypeScript
        return {
          createdBy: userId,
          approved: false,
          product: existingProduct!._id,
          oldStock: existingProduct!.stock, // Pull from DB (fixed from original code)
          quantity: productData.quantity,
          newStock: existingProduct!.stock + productData.quantity, // Calculate new stock,
          purpose: "STOCK_UPDATE",
        };
      });

      // Bulk insert in ONE operation
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
    console.log(error);

    // Abort transaction if needed (withTransaction handles it, but explicit for safety)
    if (session.inTransaction()) await session.abortTransaction();
    return getServerErrorLog(res, error);
  } finally {
    session.endSession();
  }
};
export const getInventoryUpdateRequest = async (
  req: Request,
  res: Response
) => {
  try {
    const inventory = await Stock.find({ approved: false })
      .populate("product")
      .populate("createdBy")
      .sort({ createdAt: -1 });
    if (inventory) {
      return ApiResponse(
        res,
        200,
        true,
        "These are the requests that are needed to update",
        inventory
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

export const rejectInventoryRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { stockId } = req.body;
  const userId = req.user?.id || req.user?._id; // Assuming user ID is available in req.user
  const session = await mongoose.startSession();

  try {
    const result = await session.withTransaction(async () => {
      const product = await Stock.findOneAndUpdate(
        {
          _id: stockId,
        },
        {
          $set: {
            rejected: true,
            actionBy: userId,
            actionAt: new Date(),
          },
        },
        {
          new: true, // Return the updated document
          session: session,
        }
      );

      if (!product) {
        throw new ApiError(404, "Product not found");
      }

      return product;
    });

    return ApiResponse(res, 200, true, "Request rejected successfully", result);
  } catch (error: any) {
    return getServerErrorLog(res, error);
  } finally {
    session.endSession();
  }
};

// Depreciated function, kept for reference
// export const acceptInventoryRequest = async (
//   req: AuthenticatedRequest,
//   res: Response
// ) => {
//   const { requestId } = req.body;
//   const session = await mongoose.startSession();
//   const userId = req.user?.id;

//   try {
//     await session.withTransaction(async () => {
//       const stockUpdateRequest = await Stock.findById(requestId).session(
//         session
//       );
//       if (!stockUpdateRequest) {
//         throw new ApiError(404, "Unable to find the request");
//       }
//       const productId = stockUpdateRequest.product._id;
//       const availableProduct = await Product.findById(productId).session(
//         session
//       );
//       if (!availableProduct) {
//         throw new ApiError(404, "Product not found");
//       }

//       // Update the product's stock within the session
//       const updatedProduct = await Product.findByIdAndUpdate(
//         productId,
//         { $inc: { stock: stockUpdateRequest.quantity } },
//         { new: true, session }
//       );
//       if (!updatedProduct) {
//         throw new ApiError(
//           400,
//           "Unable to update the product!! Please try again"
//         );
//       }
//       stockUpdateRequest.stockAtUpdate = availableProduct.stock;
//       stockUpdateRequest.newStock = updatedProduct.stock;
//       stockUpdateRequest.approved = true;
//       stockUpdateRequest.approvedBy = userId;
//       await stockUpdateRequest.save({ session });

//       await Logger.create(
//         [
//           {
//             name: "STOCK_UPDATE",
//             previousQuantity: availableProduct.stock,
//             newQuantity: updatedProduct.stock,
//             product: availableProduct._id,
//             quantity: stockUpdateRequest.quantity,
//           },
//         ],
//         { session }
//       );
//     });

//     return ApiResponse(res, 200, true, "Stock Updated successfully");
//   } catch (error: any) {
//     return getServerErrorLog(res, error);
//   } finally {
//     session.endSession();
//   }
// };

export const acceptAllInventoryRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { inventoryRequests } = req.body; // Expecting { inventoryRequests: string[] } (array of Stock _ids)
  const userId = req.user?.id;
  const session = await mongoose.startSession();

  // Early validation
  if (!Array.isArray(inventoryRequests) || inventoryRequests.length === 0) {
    session.endSession();
    throw new ApiError(400, "Invalid or empty inventoryRequests array");
  }

  // De-dupe IDs
  const requestIds = [...new Set(inventoryRequests)]; // Remove duplicates
  if (requestIds.length !== inventoryRequests.length) {
    session.endSession();
    throw new ApiError(400, "Duplicate request IDs in payload");
  }

  try {
    const result = await session.withTransaction(async () => {
      // Bulk fetch all Stock requests in ONE query
      const stockRequests = await Stock.find({
        _id: { $in: requestIds },
        approved: false,
        rejected: false,
      }) // Only unapproved
        .select("_id product quantity") // Only needed fields
        .lean()
        .session(session)
        .exec();

      // Validate all exist and are unapproved
      const fetchedIds = stockRequests.map((s) => s._id.toString());
      const missingIds = requestIds.filter((id) => !fetchedIds.includes(id));
      if (missingIds.length > 0) {
        throw new ApiError(
          404,
          `Requests not found or already approved: ${missingIds.join(", ")}`
        );
      }

      // Extract unique product IDs
      const productIds = [
        ...new Set(stockRequests.map((s) => s.product.toString())),
      ];

      // Bulk fetch all Products in ONE query
      const products = await Product.find({ _id: { $in: productIds } })
        .select("_id stock")
        .lean()
        .session(session)
        .exec();

      // Create maps for O(1) lookups
      const stockMap = new Map(stockRequests.map((s) => [s._id.toString(), s]));
      const productMap = new Map(products.map((p) => [p._id.toString(), p]));

      // Prepare bulk operations
      const productBulkOps = [];
      const loggerEntries = [];
      const stockBulkOps = [];

      for (const id of requestIds) {
        const stockUpdateRequest = stockMap.get(id);
        if (!stockUpdateRequest) {
          return ApiResponse(
            res,
            400,
            false,
            "Invalid stock request ID: " + id
          );
        }
        const productId = stockUpdateRequest.product.toString();
        const availableProduct = productMap.get(productId);

        if (!availableProduct) {
          throw new ApiError(404, `Product not found: ${productId}`);
        }

        const newStock = availableProduct.stock + stockUpdateRequest.quantity;

        // Product stock update
        productBulkOps.push({
          updateOne: {
            filter: { _id: availableProduct._id },
            update: { $inc: { stock: stockUpdateRequest.quantity } },
          },
        });

        // Logger entry
        loggerEntries.push({
          name: "STOCK_UPDATE",
          previousQuantity: availableProduct.stock,
          newQuantity: newStock,
          quantity: stockUpdateRequest.quantity,
          product: availableProduct._id,
        });

        // Stock request update
        stockBulkOps.push({
          updateOne: {
            filter: { _id: stockUpdateRequest._id },
            update: {
              $set: {
                stockAtUpdate: availableProduct.stock,
                newStock,
                approved: true,
                actionBy: userId,
                actionAt: new Date(), // Add if needed (per schema)
              },
            },
          },
        });
      }

      // Execute bulk updates
      if (productBulkOps.length > 0) {
        await Product.bulkWrite(productBulkOps, { session });
      }
      if (loggerEntries.length > 0) {
        await Logger.insertMany(loggerEntries, { session });
      }
      if (stockBulkOps.length > 0) {
        await Stock.bulkWrite(stockBulkOps, { session });
      }

      return { updatedCount: requestIds.length };
    });

    return ApiResponse(res, 200, true, `All stock updates successful`);
  } catch (error: any) {
    if (session.inTransaction()) await session.abortTransaction();
    return getServerErrorLog(res, error);
  } finally {
    session.endSession();
  }
};
