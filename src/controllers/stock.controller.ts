import { Request, Response } from "express";
import mongoose from "mongoose";
import Product from "../models/product.model";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import Stock from "../models/stock.model";
import ApiResponse from "../utils/ApiResponse";
import { ApiError, getServerErrorLog } from "../utils";
import moment from "moment-timezone";

const IST = "Asia/Kolkata";

import { addJourneyLog } from "../services/logger.service";

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

    const start = moment.tz(startDate as string, IST).startOf("day").toDate();
    const end = moment.tz(endDate as string, IST).endOf("day").toDate();

    // Fetch all requests in the date range
    const requests = await Stock.find({
      date: {
        $gte: start,
        $lte: end,
      },
    })
      .populate([
        { path: "product", select: "name stock" },
        { path: "createdBy", select: "name username" },
        { path: "actionBy", select: "name username" },
      ])
      .sort({ createdAt: -1 })
      .lean()
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
) => { };

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
        .select("_id stock name") // Added 'name' to fetch product names for error messages
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

      // Check for existing unapproved stock updates for these products
      const pendingStocks = await Stock.find({
        product: { $in: uniqueIds },
        approved: false,
        rejected: false,
      })
        .select("product")
        .lean()
        .session(session)
        .exec();

      // Create a set of product IDs with pending updates
      const pendingProductIds = new Set(
        pendingStocks.map((s) => s.product.toString())
      );

      // Find products in the request that already have pending updates
      const pendingProducts = products
        .filter((p) => pendingProductIds.has(p.id))
        .map((p) => productMap.get(p.id)!.name); // Use non-null assertion since we validated existence

      if (pendingProducts.length > 0) {
        throw new ApiError(
          400,
          `Stock updates already exist for the following products: ${pendingProducts.join(
            ", "
          )}`
        );
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
          newStock: existingProduct!.stock + productData.quantity, // Calculate new stock
          purpose: "STOCK_UPDATE",
        };
      });

      // Bulk insert in ONE operation
      const createdItems = await Stock.insertMany(updateProductsData, {
        session,
      });

      if (createdItems.length === 0) {
        throw new ApiError(500, "Failed to create stock update requests");
      }
      const populatedCreatedItems = await Stock.find({
        _id: { $in: createdItems.map((item) => item._id) },
      })
        .populate([
          { path: "product", select: "name stock" },
          { path: "createdBy", select: "name username" },
        ])
        .session(session)
        .lean()
        .exec();

      return populatedCreatedItems;
    });

    const io = req.app.get("io");
    if (io) {
      console.log("Emitting INVENTORY_UPDATE_REQUEST event");
      io.emit("INVENTORY_UPDATE_REQUEST", result);
    }
    console.log("Inventory update request created:", result);

    await addJourneyLog(
      req,
      "STOCK_REQUEST_CREATED",
      `Stock update request created for ${products.length} products`,
      userId,
      "StockRequest",
      null,
      { count: products.length }
    );

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
    const inventory = await Stock.find({ approved: false, rejected: false })
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

  const { id } = req.params;
  const user = req.user;
  if (!user) {
    return ApiResponse(res, 401, false, "User not found");
  }
  const userId = user.id || user._id;
  const session = await mongoose.startSession();

  try {
    const result = await session.withTransaction(async () => {
      const product = await Stock.findOneAndUpdate(
        {
          _id: id,
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

    const io = req.app.get("io");
    const startTime = moment.tz(IST).startOf("day").toDate();
    const endTime = moment.tz(IST).endOf("day").toDate();
    const createdAt = result.createdAt;
    if (createdAt >= startTime && createdAt <= endTime) {
      io.emit("INVENTORY_REJECTED", result._id);
    }

    await addJourneyLog(
      req,
      "STOCK_REQUEST_REJECTED",
      `Stock update request was rejected`,
      userId,
      "StockRequest",
      result._id
    );

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
  const { inventoryRequests } = req.body; // expecting { inventoryRequests: string[] }
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
      })
        .select("_id product quantity createdAt") // make sure to include createdAt
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
      const productMap = new Map(products.map((p) => [p._id.toString(), p]));

      // Group updates by product to handle aggregation (fix for multiple requests per product)
      const productUpdates = new Map<
        string,
        { totalQty: number; product: any; requests: any[] }
      >();
      for (const s of stockRequests) {
        const pid = s.product.toString();
        const product = productMap.get(pid);
        if (!product) {
          throw new ApiError(404, `Product not found: ${pid}`);
        }
        if (!productUpdates.has(pid)) {
          productUpdates.set(pid, { totalQty: 0, product, requests: [] });
        }
        productUpdates.get(pid)!.totalQty += s.quantity;
        productUpdates.get(pid)!.requests.push(s);
      }

      // Prepare bulk operations arrays
      const productBulkOps = [];
      const stockBulkOps = [];

      // Collect updated products details for emission
      const updatedProducts = [];

      // Array to hold all stock requests that were updated
      const updatedRequests: any[] = [];

      for (const [pid, { totalQty, product, requests }] of productUpdates) {
        const previousStock = product.stock;
        const newStock = previousStock + totalQty;

        // Product stock update ($inc for safety)
        productBulkOps.push({
          updateOne: {
            filter: { _id: product._id },
            update: { $inc: { stock: totalQty } },
          },
        });

        // Update all stock requests for this product
        for (const s of requests) {
          // Push the request into updatedRequests array
          updatedRequests.push({ ...s, previousStock, newStock, totalQty });

          // Push bulk update operation for stock request
          stockBulkOps.push({
            updateOne: {
              filter: { _id: s._id },
              update: {
                $set: {
                  stockAtUpdate: previousStock,
                  newStock,
                  approved: true,
                  actionBy: userId,
                  actionAt: new Date(),
                },
              },
            },
          });
        }

        // Collect updated product info for emission
        updatedProducts.push({
          productId: pid,
          previousStock,
          newStock,
          quantityAdded: totalQty,
        });
      }

      // Execute bulk operations within the transaction/session
      if (productBulkOps.length > 0) {
        await Product.bulkWrite(productBulkOps, { session });
      }
      if (stockBulkOps.length > 0) {
        await Stock.bulkWrite(stockBulkOps, { session });
      }

      return {
        updatedCount: requestIds.length,
        updatedProducts,
        updatedRequests,
      };
    });

    // Emit event to socket.io if available
    const io = req.app.get("io");
    if (io) {
      io.emit("INVENTORY_UPDATED", { action: "acceptAll", data: result });
    }

    await addJourneyLog(
      req,
      "STOCK_REQUEST_APPROVED",
      `Stock update requests for ${result.updatedCount} products approved`,
      userId,
      "StockRequest",
      null,
      {
        updatedCount: result.updatedCount,
        stockChanges: result.updatedProducts
      }
    );

    return ApiResponse(res, 200, true, `All stock updates successful`);
  } catch (error: any) {
    console.error(error);
    if (session.inTransaction()) await session.abortTransaction();
    return getServerErrorLog(res, error);
  } finally {
    session.endSession();
  }
};
