import { Response } from "express";
import mongoose from "mongoose";
import Product from "../models/product.model";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import Stock from "../models/stock.model";
import ApiResponse from "../utils/ApiResponse";
import { ApiError, getServerErrorLog } from "../utils";
import moment from "moment-timezone";

const IST = "Asia/Kolkata";

import { journeyQueue } from "../queues/journeyQueue";

export const getAllRequests = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const shopId = req.shopId!;
    const { startDate, endDate, page = 1, limit = 15, search, status } = req.query;

    if (!startDate || !endDate) {
      return ApiResponse(res, 400, false, "Both startDate and endDate are required");
    }

    const start = moment.tz(startDate as string, IST).startOf("day").toDate();
    const end = moment.tz(endDate as string, IST).endOf("day").toDate();

    const query: any = {
      shopId,
      date: {
        $gte: start,
        $lte: end,
      },
    };

    if (status && status !== "all") {
      if (status === "Approved") query.approved = true;
      else if (status === "Rejected") query.rejected = true;
      else if (status === "Pending") {
        query.approved = false;
        query.rejected = false;
      }
    }

    if (search) {
      const searchStr = String(search).trim();

      const products = await mongoose.model("Product").find({ shopId, name: { $regex: searchStr, $options: "i" } }).select("_id").lean();
      const productIds = products.map((p: any) => p._id);

      const users = await mongoose.model("User").find({
        $or: [
          { name: { $regex: searchStr, $options: "i" } },
          { username: { $regex: searchStr, $options: "i" } }
        ]
      }).select("_id").lean();
      const userIds = users.map((u: any) => u._id);

      query.$or = [
        { product: { $in: productIds } },
        { createdBy: { $in: userIds } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [requests, total] = await Promise.all([
      Stock.find(query)
        .populate([
          { path: "product", select: "name stock" },
          { path: "createdBy", select: "name username" },
          { path: "actionBy", select: "name username" },
        ])
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean()
        .exec(),
      Stock.countDocuments(query)
    ]);

    if (requests.length > 0) {
      return ApiResponse(res, 200, true, "Requests found", {
        requests,
        total,
        page: Number(page),
        limit: Number(limit)
      });
    } else {
      return ApiResponse(res, 200, true, "No requests found for the given date range", {
        requests: [],
        total: 0,
        page: Number(page),
        limit: Number(limit)
      });
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
  const shopId = req.shopId!;
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
      // Bulk fetch all products SCOPED to this shop in ONE query
      const existingProducts = await Product.find({ _id: { $in: uniqueIds }, shopId })
        .select("_id stock name")
        .lean()
        .session(session)
        .exec();

      const productMap = new Map(
        existingProducts.map((p) => [p._id.toString(), p])
      );

      const missingIds = uniqueIds.filter((id) => !productMap.has(id as string));
      if (missingIds.length > 0) {
        throw new ApiError(404, `Products not found: ${missingIds.join(", ")}`);
      }

      // Check for existing unapproved stock updates SCOPED to this shop
      const pendingStocks = await Stock.find({
        shopId,
        product: { $in: uniqueIds },
        approved: false,
        rejected: false,
      })
        .select("product")
        .lean()
        .session(session)
        .exec();

      const pendingProductIds = new Set(
        pendingStocks.map((s) => s.product.toString())
      );

      const pendingProducts = products
        .filter((p) => pendingProductIds.has(p.id))
        .map((p) => (productMap.get(p.id) as any).name);

      if (pendingProducts.length > 0) {
        throw new ApiError(
          400,
          `Stock updates already exist for the following products: ${pendingProducts.join(", ")}`
        );
      }

      // Prepare bulk insert data — include shopId in each record
      const updateProductsData = products.map((productData) => {
        const existingProduct = productMap.get(productData.id) as any;
        return {
          shopId,
          createdBy: userId,
          approved: false,
          product: existingProduct._id,
          oldStock: existingProduct.stock,
          quantity: productData.quantity,
          newStock: existingProduct.stock + productData.quantity,
          purpose: "STOCK_UPDATE",
          rejected: false,
        };
      });

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
      io.to(`shop:${shopId}`).emit("INVENTORY_UPDATE_REQUEST", result);
    }
    console.log("Inventory update request created:", result);

    journeyQueue.add("stock-request-created", {
      shopId: shopId.toString(),
      journeyLog: {
        eventType: "STOCK_REQUEST_CREATED",
        message: `Stock update request created for ${products.length} products`,
        createdBy: userId,
        entityType: "StockRequest",
        entityId: null,
        metadata: { count: products.length }
      }
    });

    return ApiResponse(res, 201, true, "Sent for verification to admin", {
      data: result,
    });
  } catch (error: any) {
    console.log(error);
    if (session.inTransaction()) await session.abortTransaction();
    return getServerErrorLog(res, error);
  } finally {
    session.endSession();
  }
};
export const getInventoryUpdateRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const shopId = req.shopId!;
    const inventory = await Stock.find({ shopId, approved: false, rejected: false })
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
  const shopId = req.shopId!;
  const { id } = req.params;
  const user = req.user;
  if (!user) {
    return ApiResponse(res, 401, false, "User not found");
  }
  const userId = user.id || user._id;
  const session = await mongoose.startSession();

  try {
    const result = await session.withTransaction(async () => {
      // IDOR prevention: must belong to this shop
      const product = await Stock.findOneAndUpdate(
        {
          _id: id,
          shopId,
        },
        {
          $set: {
            rejected: true,
            actionBy: userId,
            actionAt: new Date(),
          },
        },
        {
          new: true,
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
      io.to(`shop:${shopId}`).emit("INVENTORY_REJECTED", result._id);
    }

    journeyQueue.add("stock-request-rejected", {
      shopId: shopId.toString(),
      journeyLog: {
        eventType: "STOCK_REQUEST_REJECTED",
        message: `Stock update request was rejected`,
        createdBy: userId,
        entityType: "StockRequest",
        entityId: result._id
      }
    });

    return ApiResponse(res, 200, true, "Request rejected successfully", result);
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
  const shopId = req.shopId!;
  const { inventoryRequests } = req.body;
  const userId = req.user?.id;
  const session = await mongoose.startSession();

  if (!Array.isArray(inventoryRequests) || inventoryRequests.length === 0) {
    session.endSession();
    throw new ApiError(400, "Invalid or empty inventoryRequests array");
  }

  const requestIds = [...new Set(inventoryRequests)];
  if (requestIds.length !== inventoryRequests.length) {
    session.endSession();
    throw new ApiError(400, "Duplicate request IDs in payload");
  }

  try {
    const result = await session.withTransaction(async () => {
      // Bulk fetch all Stock requests SCOPED to this shop in ONE query
      const stockRequests = await Stock.find({
        _id: { $in: requestIds },
        shopId,
        approved: false,
        rejected: false,
      })
        .select("_id product quantity createdAt")
        .lean()
        .session(session)
        .exec();

      const fetchedIds = stockRequests.map((s) => s._id.toString());
      const missingIds = requestIds.filter((id) => !fetchedIds.includes(id));
      if (missingIds.length > 0) {
        throw new ApiError(
          404,
          `Requests not found or already approved: ${missingIds.join(", ")}`
        );
      }

      const productIds = [
        ...new Set(stockRequests.map((s) => s.product.toString())),
      ];

      // Bulk fetch all Products SCOPED to this shop in ONE query
      const products = await Product.find({ _id: { $in: productIds }, shopId })
        .select("_id stock")
        .lean()
        .session(session)
        .exec();

      const productMap = new Map(products.map((p) => [p._id.toString(), p]));

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

      const productBulkOps = [];
      const stockBulkOps = [];
      const updatedProducts = [];
      const updatedRequests: any[] = [];

      for (const [pid, { totalQty, product, requests }] of productUpdates) {
        const previousStock = product.stock;
        const newStock = previousStock + totalQty;

        productBulkOps.push({
          updateOne: {
            filter: { _id: product._id, shopId },
            update: { $inc: { stock: totalQty } },
          },
        });

        for (const s of requests) {
          updatedRequests.push({ ...s, previousStock, newStock, totalQty });

          stockBulkOps.push({
            updateOne: {
              filter: { _id: s._id, shopId },
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

        updatedProducts.push({
          productId: pid,
          previousStock,
          newStock,
          quantityAdded: totalQty,
        });
      }

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

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit("INVENTORY_UPDATED", { action: "acceptAll", data: result });
    }

    journeyQueue.add("stock-request-approved", {
      shopId: shopId.toString(),
      journeyLog: {
        eventType: "STOCK_REQUEST_APPROVED",
        message: `Stock update requests for ${result.updatedCount} products approved`,
        createdBy: userId,
        entityType: "StockRequest",
        entityId: null,
        metadata: {
          updatedCount: result.updatedCount,
          stockChanges: result.updatedProducts
        }
      }
    });

    return ApiResponse(res, 200, true, `All stock updates successful`);
  } catch (error: any) {
    console.error(error);
    if (session.inTransaction()) await session.abortTransaction();
    return getServerErrorLog(res, error);
  } finally {
    session.endSession();
  }
};
