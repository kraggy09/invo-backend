import { Response } from "express";
import mongoose from "mongoose";
import moment from "moment-timezone";
import SupplierPurchase from "../models/supplierPurchase.model";
import Supplier from "../models/supplier.model";
import Product from "../models/product.model";
import Stock from "../models/stock.model";
import PriceHistory from "../models/priceHistory.model";
import Transaction from "../models/transaction.model";
import Counter from "../models/counter.model";
import ApiResponse from "../utils/ApiResponse";
import { ApiError, getServerErrorLog } from "../utils";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import { EVENTS_MAP } from "../constant/redisMap";

const IST = "Asia/Kolkata";

export const raiseSupplierPurchase = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const shopId = req.shopId!;
  const userId = req.user?.id || req.user?._id;
  const { supplierId, products } = req.body;

  if (!supplierId) {
    return ApiResponse(res, 400, false, "Supplier is required");
  }

  if (!Array.isArray(products) || products.length === 0) {
    return ApiResponse(res, 400, false, "At least one product is required");
  }

  try {
    const productIds = products.map((p) => p.id);

    // Parallel initial reads with field projections
    const [supplier, existingProducts] = await Promise.all([
      Supplier.findOne({ _id: supplierId, shopId }).lean(),
      Product.find(
        { _id: { $in: productIds }, shopId },
        {
          name: 1,
          barcode: 1,
          measuring: 1,
          mrp: 1,
          costPrice: 1,
          retailPrice: 1,
          wholesalePrice: 1,
          superWholesalePrice: 1,
          stock: 1,
          packet: 1,
          box: 1,
        },
      ).lean(),
    ]);

    if (!supplier) {
      return ApiResponse(res, 404, false, "Supplier not found");
    }

    const productMap = new Map(
      existingProducts.map((p: any) => [p._id.toString(), p]),
    );

    const items = products.map((p) => {
      const prod = productMap.get(p.id);
      if (!prod) {
        throw new ApiError(404, `Product not found: ${p.id}`);
      }
      const qty = Number(p.quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new ApiError(400, `Invalid quantity for product ${prod.name}`);
      }

      return {
        product: prod._id,
        quantity: qty,
        previousCostPrice: prod.costPrice,
        previousRetailPrice: prod.retailPrice,
        previousWholesalePrice: prod.wholesalePrice || 0,
        previousSuperWholesalePrice: prod.superWholesalePrice || 0,
        newCostPrice: prod.costPrice, // default to previous CP
        newRetailPrice: prod.retailPrice,
        newWholesalePrice: prod.wholesalePrice || 0,
        newSuperWholesalePrice: prod.superWholesalePrice || 0,
        priceUpdated: false,
      };
    });

    const newPurchase = await SupplierPurchase.create({
      shopId,
      supplier: supplier._id,
      status: "PENDING",
      raisedBy: userId,
      raisedAt: new Date(),
      items,
    });

    // In-memory populated purchase (no extra DB call)
    const user = req.user;
    const populatedPurchase = {
      ...newPurchase.toObject(),
      supplier: {
        _id: supplier._id,
        name: supplier.name,
        phone: supplier.phone,
        outstanding: supplier.outstanding,
      },
      raisedBy: user
        ? { _id: user._id, name: user.name, username: user.username }
        : { _id: userId },
      items: items.map((item) => ({
        ...item,
        product: productMap.get(item.product.toString()) || item.product,
      })),
    };

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(
        EVENTS_MAP.SUPPLIER_PURCHASE_CREATED,
        populatedPurchase,
      );
    }

    return ApiResponse(
      res,
      201,
      true,
      "Purchase request raised successfully",
      populatedPurchase,
    );
  } catch (error: any) {
    console.error("Error raising supplier purchase:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const acceptSupplierPurchase = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const shopId = req.shopId!;
  const userId = req.user?.id || req.user?._id;
  const { id } = req.params;
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return ApiResponse(res, 400, false, "Item price updates are required");
  }

  try {
    const purchase = await SupplierPurchase.findOne({
      _id: id,
      shopId,
    })
      .populate("supplier", "name phone outstanding")
      .populate("raisedBy", "name username")
      .populate(
        "items.product",
        "name barcode measuring mrp costPrice retailPrice wholesalePrice superWholesalePrice stock packet box",
      );

    if (!purchase) {
      return ApiResponse(res, 404, false, "Purchase not found");
    }

    if (purchase.status !== "PENDING") {
      return ApiResponse(
        res,
        400,
        false,
        `Cannot accept purchase in ${purchase.status} state`,
      );
    }

    const itemsMap = new Map(items.map((i: any) => [i.productId, i]));

    let totalAmount = 0;
    purchase.items.forEach((item: any) => {
      const pid = item.product?._id
        ? item.product._id.toString()
        : item.product.toString();
      const update = itemsMap.get(pid);
      if (update) {
        if (update.newCostPrice !== undefined) {
          item.newCostPrice = Number(update.newCostPrice);
        }
        if (update.priceUpdated) {
          item.priceUpdated = true;
          if (update.newRetailPrice !== undefined) {
            item.newRetailPrice = Number(update.newRetailPrice);
          }
          if (update.newWholesalePrice !== undefined) {
            item.newWholesalePrice = Number(update.newWholesalePrice);
          }
          if (update.newSuperWholesalePrice !== undefined) {
            item.newSuperWholesalePrice = Number(update.newSuperWholesalePrice);
          }
        }
      }
      const unitCp = item.newCostPrice ?? item.previousCostPrice ?? 0;
      totalAmount += item.quantity * unitCp;
    });

    purchase.totalAmount = totalAmount;
    purchase.status = "ACCEPTED";
    purchase.acceptedBy = userId;
    purchase.acceptedAt = new Date();

    await purchase.save();

    // Construct populated purchase using in-memory data
    const user = req.user;
    const populatedPurchase = {
      ...purchase.toObject(),
      acceptedBy: user
        ? { _id: user._id, name: user.name, username: user.username }
        : { _id: userId },
    };

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(
        EVENTS_MAP.SUPPLIER_PURCHASE_ACCEPTED,
        populatedPurchase,
      );
    }

    return ApiResponse(
      res,
      200,
      true,
      "Purchase accepted and prices saved",
      populatedPurchase,
    );
  } catch (error: any) {
    console.error("Error accepting supplier purchase:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const approveSupplierPurchase = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const shopId = req.shopId!;
  const userId = req.user?.id || req.user?._id;
  const { id } = req.params;
  const { paymentMode = "CREDIT", cashPaid: inputCashPaid = 0 } = req.body;

  const session = await mongoose.startSession();

  try {
    let result: any = null;

    await session.withTransaction(async () => {
      const purchase = await SupplierPurchase.findOne({
        _id: id,
        shopId,
      })
        .populate("raisedBy", "name username")
        .populate("acceptedBy", "name username")
        .session(session);

      if (!purchase) {
        throw new ApiError(404, "Purchase not found");
      }

      if (purchase.status !== "PENDING" && purchase.status !== "ACCEPTED") {
        throw new ApiError(
          400,
          `Cannot approve purchase in ${purchase.status} state.`,
        );
      }

      // If items price updates are passed along with approval, update them directly
      if (Array.isArray(req.body.items) && req.body.items.length > 0) {
        const itemsMap = new Map<string, any>(
          req.body.items.map((i: any) => [String(i.productId), i]),
        );
        purchase.items.forEach((item: any) => {
          const pid = item.product?._id
            ? item.product._id.toString()
            : item.product.toString();
          const update: any = itemsMap.get(pid);
          if (update) {
            if (
              update.newCostPrice !== undefined &&
              update.newCostPrice !== null
            ) {
              item.newCostPrice = Number(update.newCostPrice);
            }
            if (update.priceUpdated) {
              item.priceUpdated = true;
            }
            if (
              update.newRetailPrice !== undefined &&
              update.newRetailPrice !== null
            ) {
              item.newRetailPrice = Number(update.newRetailPrice);
            }
            if (
              update.newWholesalePrice !== undefined &&
              update.newWholesalePrice !== null
            ) {
              item.newWholesalePrice = Number(update.newWholesalePrice);
            }
            if (
              update.newSuperWholesalePrice !== undefined &&
              update.newSuperWholesalePrice !== null
            ) {
              item.newSuperWholesalePrice = Number(
                update.newSuperWholesalePrice,
              );
            }
          }
        });
      }

      purchase.acceptedBy = purchase.acceptedBy || userId;
      purchase.acceptedAt = purchase.acceptedAt || new Date();

      const productIds = purchase.items.map((i) => i.product?._id || i.product);

      // Parallel reads for supplier and products
      const [supplier, existingProducts] = await Promise.all([
        Supplier.findOne({
          _id: purchase.supplier,
          shopId,
        }).session(session),
        Product.find(
          { _id: { $in: productIds }, shopId },
          {
            name: 1,
            barcode: 1,
            measuring: 1,
            mrp: 1,
            costPrice: 1,
            retailPrice: 1,
            wholesalePrice: 1,
            superWholesalePrice: 1,
            stock: 1,
            packet: 1,
            box: 1,
          },
        ).session(session),
      ]);

      if (!supplier) {
        throw new ApiError(404, "Supplier not found");
      }

      // Calculate total amount
      let totalAmount = 0;
      for (const item of purchase.items) {
        const unitCp = item.newCostPrice ?? item.previousCostPrice ?? 0;
        totalAmount += item.quantity * unitCp;
      }

      const previousSupplierOutstanding = supplier.outstanding || 0;
      const maxAllowedCash =
        totalAmount + Math.max(0, previousSupplierOutstanding);

      let cashPaid = 0;
      let creditAmount = 0;

      if (paymentMode === "CASH") {
        cashPaid = totalAmount;
        creditAmount = 0;
      } else if (paymentMode === "CREDIT") {
        cashPaid = 0;
        creditAmount = totalAmount;
      } else if (paymentMode === "PARTIAL") {
        cashPaid = Number(inputCashPaid) || 0;
        if (cashPaid > maxAllowedCash) {
          cashPaid = maxAllowedCash;
        }
        creditAmount = Math.max(0, totalAmount - cashPaid);
      }

      const grossSupplierOutstanding =
        previousSupplierOutstanding + totalAmount;
      const newSupplierOutstanding = grossSupplierOutstanding - cashPaid;

      supplier.outstanding = newSupplierOutstanding;
      await supplier.save({ session });

      const productMap = new Map(
        existingProducts.map((p: any) => [p._id.toString(), p]),
      );

      const productBulkOps = [];
      const stockDocs = [];
      const priceHistoryDocs = [];
      const updatedProductsForSocket: any[] = [];

      for (const item of purchase.items) {
        const prodId = item.product?._id
          ? item.product._id.toString()
          : item.product.toString();
        const prod = productMap.get(prodId);
        if (!prod) {
          throw new ApiError(404, `Product not found: ${item.product}`);
        }

        const oldStock = prod.stock;
        const newStock = oldStock + item.quantity;
        const oldCp = prod.costPrice;
        const oldRetail = prod.retailPrice;
        const oldWholesale = prod.wholesalePrice || 0;
        const oldSuperWholesale = prod.superWholesalePrice || 0;

        const newCp = item.newCostPrice ?? prod.costPrice;

        const updateFields: any = {
          $inc: { stock: item.quantity },
          $set: { costPrice: newCp },
        };

        let newRetail = oldRetail;
        let newWholesale = oldWholesale;
        let newSuperWholesale = oldSuperWholesale;

        if (item.priceUpdated) {
          if (item.newRetailPrice !== undefined) {
            newRetail = item.newRetailPrice;
            updateFields.$set.retailPrice = newRetail;
          }
          if (item.newWholesalePrice !== undefined) {
            newWholesale = item.newWholesalePrice;
            updateFields.$set.wholesalePrice = newWholesale;
          }
          if (item.newSuperWholesalePrice !== undefined) {
            newSuperWholesale = item.newSuperWholesalePrice;
            updateFields.$set.superWholesalePrice = newSuperWholesale;
          }
        }

        // Keep in-memory prod object synced with updated stock and prices
        prod.stock = newStock;
        prod.costPrice = newCp;
        prod.retailPrice = newRetail;
        prod.wholesalePrice = newWholesale;
        prod.superWholesalePrice = newSuperWholesale;

        productBulkOps.push({
          updateOne: {
            filter: { _id: prod._id, shopId },
            update: updateFields,
          },
        });

        // Price history record - only if at least one price changed
        const hasPriceChanged =
          oldCp !== newCp ||
          oldRetail !== newRetail ||
          oldWholesale !== newWholesale ||
          oldSuperWholesale !== newSuperWholesale;

        if (hasPriceChanged) {
          priceHistoryDocs.push({
            shopId,
            product: prod._id,
            changedAt: new Date(),
            changedBy: userId,
            source: "SUPPLIER_PURCHASE",
            supplierPurchase: purchase._id,
            supplier: supplier._id,
            previousCostPrice: oldCp,
            newCostPrice: newCp,
            previousRetailPrice: oldRetail,
            newRetailPrice: newRetail,
            previousWholesalePrice: oldWholesale,
            newWholesalePrice: newWholesale,
            previousSuperWholesalePrice: oldSuperWholesale,
            newSuperWholesalePrice: newSuperWholesale,
          });
        }

        // Stock audit log
        stockDocs.push({
          shopId,
          date: new Date(),
          createdBy: purchase.raisedBy?._id || purchase.raisedBy,
          actionBy: userId,
          actionAt: new Date(),
          product: prod._id,
          oldStock,
          quantity: item.quantity,
          stockAtUpdate: oldStock,
          newStock,
          approved: true,
          rejected: false,
          purpose: "SUPPLIER_PURCHASE",
        });

        updatedProductsForSocket.push({
          productId: prod._id.toString(),
          previousStock: oldStock,
          newStock,
          quantityAdded: item.quantity,
          costPrice: newCp,
          retailPrice: newRetail,
          wholesalePrice: newWholesale,
          superWholesalePrice: newSuperWholesale,
        });
      }

      // Parallel bulk writes
      const writePromises: Promise<any>[] = [];
      let insertedStockDocs: any[] = [];
      if (stockDocs.length > 0) {
        insertedStockDocs = await Stock.insertMany(stockDocs, { session });
      }
      if (productBulkOps.length > 0) {
        writePromises.push(Product.bulkWrite(productBulkOps, { session }));
      }
      if (priceHistoryDocs.length > 0) {
        writePromises.push(
          PriceHistory.insertMany(priceHistoryDocs, { session }),
        );
      }
      if (writePromises.length > 0) {
        await Promise.all(writePromises);
      }

      // If cash paid > 0, generate cash-out transaction linked to supplier & purchase
      let createdTransaction: any = null;
      if (cashPaid > 0) {
        const counter = await Counter.findOneAndUpdate(
          { shopId, name: "transactionId" },
          { $inc: { value: 1 } },
          { session, new: true, upsert: true },
        );

        const newTx = await Transaction.create(
          [
            {
              shopId,
              id: counter.value,
              name: supplier.name,
              supplier: supplier._id,
              supplierPurchaseId: purchase._id,
              previousOutstanding: grossSupplierOutstanding,
              newOutstanding: newSupplierOutstanding,
              amount: cashPaid,
              taken: true,
              purpose: `Supplier Purchase #${String((purchase as any)._id).slice(-6)} Payment`,
              approved: true,
              approvedAt: moment.tz(IST).toDate(),
              approvedBy: userId,
              paymentIn: false,
              paymentMode: "CASH",
            },
          ],
          { session },
        );

        createdTransaction = newTx[0];
      }

      // Update purchase record
      purchase.status = "APPROVED";
      purchase.approvedBy = userId;
      purchase.approvedAt = new Date();
      purchase.totalAmount = totalAmount;
      purchase.paymentMode = paymentMode;
      purchase.cashPaid = cashPaid;
      purchase.creditAmount = creditAmount;
      purchase.previousSupplierOutstanding = previousSupplierOutstanding;
      purchase.newSupplierOutstanding = newSupplierOutstanding;

      await purchase.save({ session });

      // Populate stock docs for socket emission
      const populatedStockDocs = insertedStockDocs.map((doc: any) => {
        const prodId = doc.product?.toString();
        const pObj = productMap.get(prodId);
        const creator: any = purchase.raisedBy;
        return {
          ...doc.toObject(),
          product: {
            _id: pObj?._id || doc.product,
            name: pObj?.name || "Product",
            stock: doc.newStock,
          },
          createdBy: creator?._id
            ? {
                _id: creator._id,
                name: creator.name || "User",
                username: creator.username || "user",
              }
            : req.user
              ? {
                  _id: req.user._id,
                  name: req.user.name,
                  username: req.user.username,
                }
              : { _id: userId, name: "User", username: "user" },
          actionBy: req.user
            ? {
                _id: req.user._id,
                name: req.user.name,
                username: req.user.username,
              }
            : { _id: userId, name: "User", username: "user" },
        };
      });

      result = {
        purchase,
        supplier,
        createdTransaction,
        updatedProductsForSocket,
        productMap,
        populatedStockDocs,
      };
    });

    // In-memory populated purchase (no extra DB call)
    const user = req.user;
    const populatedPurchase = {
      ...result.purchase.toObject(),
      supplier: {
        _id: result.supplier._id,
        name: result.supplier.name,
        phone: result.supplier.phone,
        outstanding: result.supplier.outstanding,
      },
      raisedBy: result.purchase.raisedBy,
      acceptedBy: result.purchase.acceptedBy,
      approvedBy: user
        ? { _id: user._id, name: user.name, username: user.username }
        : { _id: userId },
      items: result.purchase.items.map((item: any) => {
        const prodId = item.product?._id
          ? item.product._id.toString()
          : item.product.toString();
        const pObj = result.productMap.get(prodId);
        return {
          ...(item.toObject ? item.toObject() : item),
          product: pObj
            ? pObj.toObject
              ? pObj.toObject()
              : pObj
            : item.product,
        };
      }),
      updatedProducts: result.updatedProductsForSocket,
      stockDocs: result.populatedStockDocs,
    };

    const io = req.app.get("io");
    if (io) {
      // 1. Emit supplier purchase approved
      io.to(`shop:${shopId}`).emit(
        EVENTS_MAP.SUPPLIER_PURCHASE_APPROVED,
        populatedPurchase,
      );

      // 2. Emit stock & pricing updated so all clients update product inventory & daily report real-time
      const stockPayload = {
        action: "acceptAll",
        data: {
          updatedProducts: result.updatedProductsForSocket,
          stockDocs: result.populatedStockDocs,
          updatedRequests: result.populatedStockDocs,
        },
      };

      io.to(`shop:${shopId}`).emit("INVENTORY_UPDATED", stockPayload);
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.STOCK_UPDATED, stockPayload);

      // 3. Emit supplier updated with new outstanding
      io.to(`shop:${shopId}`).emit(
        EVENTS_MAP.SUPPLIER_UPDATED,
        result.supplier,
      );

      // 4. If transaction was created, emit transaction event
      if (result.createdTransaction) {
        const populatedTx = {
          ...result.createdTransaction.toObject(),
          supplier: {
            _id: result.supplier._id,
            name: result.supplier.name,
            phone: result.supplier.phone,
            outstanding: result.supplier.outstanding,
          },
          approvedBy: user
            ? { _id: user._id, name: user.name, username: user.username }
            : { _id: userId },
        };

        const supplierObj = result.supplier
          ? result.supplier.toObject
            ? result.supplier.toObject()
            : result.supplier
          : undefined;

        io.to(`shop:${shopId}`).emit(EVENTS_MAP.TRANSACTION_CREATED, {
          transaction: populatedTx,
          transactionId: result.createdTransaction.id,
          supplier: supplierObj,
        });
      }
    }

    return ApiResponse(
      res,
      200,
      true,
      "Purchase approved and stock/prices updated successfully",
      populatedPurchase,
    );
  } catch (error: any) {
    console.error("Error approving supplier purchase:", error);
    if (session.inTransaction()) await session.abortTransaction();
    return getServerErrorLog(res, error);
  } finally {
    session.endSession();
  }
};

export const rejectSupplierPurchase = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const shopId = req.shopId!;
  const userId = req.user?.id || req.user?._id;
  const { id } = req.params;

  try {
    const purchase = await SupplierPurchase.findOneAndUpdate(
      { _id: id, shopId },
      {
        $set: {
          status: "REJECTED",
          rejectedBy: userId,
          rejectedAt: new Date(),
        },
      },
      { new: true },
    )
      .populate("supplier", "name phone")
      .populate("raisedBy", "name username")
      .lean();

    if (!purchase) {
      return ApiResponse(res, 404, false, "Purchase not found");
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(
        EVENTS_MAP.SUPPLIER_PURCHASE_REJECTED,
        purchase,
      );
    }

    return ApiResponse(res, 200, true, "Purchase rejected", purchase);
  } catch (error: any) {
    console.error("Error rejecting purchase:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const discardSupplierPurchaseItem = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const shopId = req.shopId!;
  const userId = req.user?.id || req.user?._id;
  const { id, productId } = req.params;

  if (!productId) {
    return ApiResponse(res, 400, false, "Product ID is required");
  }

  try {
    const purchase = await SupplierPurchase.findOne({ _id: id, shopId })
      .populate("supplier", "name phone outstanding")
      .populate("raisedBy", "name username")
      .populate("acceptedBy", "name username")
      .populate(
        "items.product",
        "name barcode measuring mrp costPrice retailPrice wholesalePrice superWholesalePrice stock packet box",
      );

    if (!purchase) {
      return ApiResponse(res, 404, false, "Purchase not found");
    }

    if (purchase.status === "APPROVED") {
      return ApiResponse(
        res,
        400,
        false,
        "Cannot discard items from an approved purchase as stock and finances are already committed",
      );
    }

    if (purchase.status === "REJECTED") {
      return ApiResponse(
        res,
        400,
        false,
        "Cannot discard items from a rejected purchase",
      );
    }

    const itemIndex = purchase.items.findIndex((item: any) => {
      const pid = item.product?._id
        ? item.product._id.toString()
        : item.product.toString();
      return pid === productId;
    });

    if (itemIndex === -1) {
      return ApiResponse(
        res,
        404,
        false,
        "Item not found in this inward request",
      );
    }

    const io = req.app.get("io");

    // If this is the only remaining item in the purchase, discarding it rejects the whole purchase
    if (purchase.items.length <= 1) {
      purchase.status = "REJECTED";
      purchase.rejectedBy = userId;
      purchase.rejectedAt = new Date();
      await purchase.save();

      const populatedPurchase = purchase.toObject();

      if (io) {
        io.to(`shop:${shopId}`).emit(
          EVENTS_MAP.SUPPLIER_PURCHASE_REJECTED,
          populatedPurchase,
        );
      }

      return ApiResponse(
        res,
        200,
        true,
        "Last item discarded. Inward request was rejected.",
        {
          purchase: populatedPurchase,
          purchaseRejected: true,
        },
      );
    }

    // Remove the item from the items array
    purchase.items.splice(itemIndex, 1);

    // Recalculate totalAmount from remaining items
    let totalAmount = 0;
    purchase.items.forEach((item: any) => {
      const unitCp = item.newCostPrice ?? item.previousCostPrice ?? 0;
      totalAmount += (item.quantity || 0) * unitCp;
    });
    purchase.totalAmount = totalAmount;

    await purchase.save();

    const populatedPurchase = purchase.toObject();

    if (io) {
      io.to(`shop:${shopId}`).emit(
        EVENTS_MAP.SUPPLIER_PURCHASE_UPDATED,
        populatedPurchase,
      );
    }

    return ApiResponse(
      res,
      200,
      true,
      "Item discarded successfully",
      {
        purchase: populatedPurchase,
        purchaseRejected: false,
      },
    );
  } catch (error: any) {
    console.error("Error discarding purchase item:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getAllSupplierPurchases = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const {
      startDate,
      endDate,
      supplierId,
      status,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const query: any = { shopId };

    if (supplierId) {
      query.supplier = supplierId;
    }

    if (status && status !== "ALL") {
      query.status = status;
    }

    if (startDate && endDate) {
      const start = moment
        .tz(startDate as string, IST)
        .startOf("day")
        .toDate();
      const end = moment
        .tz(endDate as string, IST)
        .endOf("day")
        .toDate();
      query.createdAt = { $gte: start, $lte: end };
    }

    if (search) {
      const searchStr = String(search).trim();
      const productOrClauses: any[] = [
        { name: { $regex: searchStr, $options: "i" } },
      ];
      if (!isNaN(Number(searchStr))) {
        productOrClauses.push({ barcode: Number(searchStr) });
      }

      const [matchingSuppliers, matchingProducts] = await Promise.all([
        Supplier.find({
          shopId,
          $or: [
            { name: { $regex: searchStr, $options: "i" } },
            { phone: { $regex: searchStr, $options: "i" } },
          ],
        })
          .select("_id")
          .lean(),
        Product.find({
          shopId,
          $or: productOrClauses,
        })
          .select("_id")
          .lean(),
      ]);

      const orConditions: any[] = [
        { supplier: { $in: matchingSuppliers.map((s: any) => s._id) } },
        { "items.product": { $in: matchingProducts.map((p: any) => p._id) } },
      ];

      if (mongoose.Types.ObjectId.isValid(searchStr)) {
        orConditions.push({ _id: new mongoose.Types.ObjectId(searchStr) });
      }

      query.$or = orConditions;
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [purchases, total] = await Promise.all([
      SupplierPurchase.find(query)
        .populate("supplier", "name phone outstanding")
        .populate("raisedBy", "name username")
        .populate("acceptedBy", "name username")
        .populate("approvedBy", "name username")
        .populate(
          "items.product",
          "name barcode measuring mrp costPrice retailPrice wholesalePrice superWholesalePrice stock packet box",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      SupplierPurchase.countDocuments(query),
    ]);

    return ApiResponse(res, 200, true, "Purchases fetched successfully", {
      purchases,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    console.error("Error fetching purchases:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getProductPurchaseHistory = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const {
      productId,
      search,
      supplierId,
      startDate,
      endDate,
      status = "APPROVED",
      page = 1,
      limit = 15,
    } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 15));
    const skip = (pageNum - 1) * limitNum;

    const shopObjectId = new mongoose.Types.ObjectId(shopId);
    const matchConditions: any = { shopId: shopObjectId };

    if (status && status !== "ALL") {
      matchConditions.status = status;
    }

    if (supplierId) {
      matchConditions.supplier = new mongoose.Types.ObjectId(
        supplierId as string,
      );
    }

    if (startDate && endDate) {
      const start = moment
        .tz(startDate as string, IST)
        .startOf("day")
        .toDate();
      const end = moment
        .tz(endDate as string, IST)
        .endOf("day")
        .toDate();
      matchConditions.createdAt = { $gte: start, $lte: end };
    }

    let targetProductIds: mongoose.Types.ObjectId[] | null = null;

    if (productId && mongoose.Types.ObjectId.isValid(productId as string)) {
      targetProductIds = [new mongoose.Types.ObjectId(productId as string)];
    } else if (search) {
      const searchStr = String(search).trim();
      const productOrClauses: any[] = [
        { name: { $regex: searchStr, $options: "i" } },
      ];
      if (!isNaN(Number(searchStr))) {
        productOrClauses.push({ barcode: Number(searchStr) });
      }

      const matchingProducts = await Product.find({
        shopId,
        $or: productOrClauses,
      })
        .select("_id")
        .lean();

      targetProductIds = matchingProducts.map((p: any) => p._id);

      if (targetProductIds.length === 0) {
        return ApiResponse(
          res,
          200,
          true,
          "Product purchase history fetched successfully",
          {
            history: [],
            total: 0,
            page: pageNum,
            limit: limitNum,
            totalPages: 0,
          },
        );
      }
    }

    if (targetProductIds && targetProductIds.length > 0) {
      matchConditions["items.product"] = { $in: targetProductIds };
    }

    const pipeline: any[] = [
      { $match: matchConditions },
      { $unwind: "$items" },
    ];

    if (targetProductIds && targetProductIds.length > 0) {
      pipeline.push({
        $match: {
          "items.product": { $in: targetProductIds },
        },
      });
    }

    pipeline.push(
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: skip },
            { $limit: limitNum },
            {
              $lookup: {
                from: "suppliers",
                localField: "supplier",
                foreignField: "_id",
                as: "supplierDetails",
              },
            },
            {
              $unwind: {
                path: "$supplierDetails",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $lookup: {
                from: "products",
                localField: "items.product",
                foreignField: "_id",
                as: "productDetails",
              },
            },
            {
              $unwind: {
                path: "$productDetails",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $lookup: {
                from: "users",
                localField: "approvedBy",
                foreignField: "_id",
                as: "approvedByDetails",
              },
            },
            {
              $unwind: {
                path: "$approvedByDetails",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $lookup: {
                from: "users",
                localField: "raisedBy",
                foreignField: "_id",
                as: "raisedByDetails",
              },
            },
            {
              $unwind: {
                path: "$raisedByDetails",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                _id: 1,
                purchaseId: "$_id",
                createdAt: 1,
                approvedAt: 1,
                status: 1,
                paymentMode: 1,
                supplier: {
                  _id: "$supplierDetails._id",
                  name: "$supplierDetails.name",
                  phone: "$supplierDetails.phone",
                },
                product: {
                  _id: "$productDetails._id",
                  name: "$productDetails.name",
                  barcode: "$productDetails.barcode",
                  measuring: "$productDetails.measuring",
                  costPrice: "$productDetails.costPrice",
                  retailPrice: "$productDetails.retailPrice",
                  wholesalePrice: "$productDetails.wholesalePrice",
                  superWholesalePrice: "$productDetails.superWholesalePrice",
                  stock: "$productDetails.stock",
                },
                quantity: "$items.quantity",
                costPrice: {
                  $ifNull: [
                    "$items.newCostPrice",
                    "$items.previousCostPrice",
                    0,
                  ],
                },
                previousCostPrice: "$items.previousCostPrice",
                retailPrice: {
                  $ifNull: [
                    "$items.newRetailPrice",
                    "$items.previousRetailPrice",
                    0,
                  ],
                },
                previousRetailPrice: "$items.previousRetailPrice",
                wholesalePrice: "$items.newWholesalePrice",
                superWholesalePrice: "$items.newSuperWholesalePrice",
                priceUpdated: "$items.priceUpdated",
                totalCost: {
                  $multiply: [
                    "$items.quantity",
                    {
                      $ifNull: [
                        "$items.newCostPrice",
                        "$items.previousCostPrice",
                        0,
                      ],
                    },
                  ],
                },
                approvedBy: {
                  _id: "$approvedByDetails._id",
                  name: "$approvedByDetails.name",
                  username: "$approvedByDetails.username",
                },
                raisedBy: {
                  _id: "$raisedByDetails._id",
                  name: "$raisedByDetails.name",
                  username: "$raisedByDetails.username",
                },
              },
            },
          ],
        },
      },
    );

    const result = await SupplierPurchase.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const history = result[0]?.data || [];

    return ApiResponse(
      res,
      200,
      true,
      "Product purchase history fetched successfully",
      {
        history,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    );
  } catch (error: any) {
    console.error("Error fetching product purchase history:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getSingleSupplierPurchase = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const { id } = req.params;

    const purchase = await SupplierPurchase.findOne({ _id: id, shopId })
      .populate("supplier", "name phone outstanding address")
      .populate("raisedBy", "name username")
      .populate("acceptedBy", "name username")
      .populate("approvedBy", "name username")
      .populate(
        "items.product",
        "name barcode measuring mrp costPrice retailPrice wholesalePrice superWholesalePrice stock packet box",
      )
      .lean();

    if (!purchase) {
      return ApiResponse(res, 404, false, "Purchase not found");
    }

    // Query linked transactions on the fly
    const transactions = await Transaction.find({
      shopId,
      supplierPurchaseId: purchase._id,
    })
      .populate("approvedBy", "name username")
      .sort({ createdAt: -1 })
      .lean();

    return ApiResponse(res, 200, true, "Purchase details retrieved", {
      purchase,
      transactions,
    });
  } catch (error: any) {
    console.error("Error retrieving purchase details:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getSupplierPurchaseSummary = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const { startDate, endDate, supplierId } = req.query;

    const shopObjectId = new mongoose.Types.ObjectId(shopId);
    const matchConditions: any = { shopId: shopObjectId };

    if (supplierId && mongoose.Types.ObjectId.isValid(supplierId as string)) {
      matchConditions.supplier = new mongoose.Types.ObjectId(
        supplierId as string,
      );
    }

    if (startDate && endDate) {
      const start = moment
        .tz(startDate as string, IST)
        .startOf("day")
        .toDate();
      const end = moment
        .tz(endDate as string, IST)
        .endOf("day")
        .toDate();
      matchConditions.createdAt = { $gte: start, $lte: end };
    } else if (startDate) {
      const start = moment
        .tz(startDate as string, IST)
        .startOf("day")
        .toDate();
      matchConditions.createdAt = { $gte: start };
    } else if (endDate) {
      const end = moment
        .tz(endDate as string, IST)
        .endOf("day")
        .toDate();
      matchConditions.createdAt = { $lte: end };
    }

    const [summaryResult] = await SupplierPurchase.aggregate([
      { $match: matchConditions },
      {
        $facet: {
          approvedPurchases: [
            { $match: { status: "APPROVED" } },
            {
              $group: {
                _id: null,
                totalPurchases: { $sum: { $ifNull: ["$totalAmount", 0] } },
                totalCashPaid: { $sum: { $ifNull: ["$cashPaid", 0] } },
                totalCredit: { $sum: { $ifNull: ["$creditAmount", 0] } },
                approvedCount: { $sum: 1 },
                creditBillsCount: {
                  $sum: {
                    $cond: [
                      { $gt: [{ $ifNull: ["$creditAmount", 0] }, 0] },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          approvedItems: [
            { $match: { status: "APPROVED" } },
            { $unwind: "$items" },
            {
              $group: {
                _id: null,
                totalUnits: { $sum: { $ifNull: ["$items.quantity", 0] } },
                uniqueProducts: { $addToSet: "$items.product" },
                priceUpdatesCount: {
                  $sum: {
                    $cond: [{ $eq: ["$items.priceUpdated", true] }, 1, 0],
                  },
                },
              },
            },
          ],
          pendingPurchases: [
            { $match: { status: { $in: ["PENDING", "ACCEPTED"] } } },
            {
              $group: {
                _id: null,
                pendingCount: { $sum: 1 },
                pendingAmount: { $sum: { $ifNull: ["$totalAmount", 0] } },
              },
            },
          ],
          totalOverall: [
            {
              $group: {
                _id: null,
                totalCount: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]);

    const approved = summaryResult?.approvedPurchases?.[0] || {};
    const items = summaryResult?.approvedItems?.[0] || {};
    const pending = summaryResult?.pendingPurchases?.[0] || {};
    const overall = summaryResult?.totalOverall?.[0] || {};

    const totalPurchases = approved.totalPurchases || 0;
    const totalCashPaid = approved.totalCashPaid || 0;
    const totalCredit = approved.totalCredit || 0;
    const approvedCount = approved.approvedCount || 0;
    const creditBillsCount = approved.creditBillsCount || 0;

    const totalUnits = items.totalUnits || 0;
    const uniqueProductsCount = items.uniqueProducts?.length || 0;
    const priceUpdatesCount = items.priceUpdatesCount || 0;

    const pendingCount = pending.pendingCount || 0;
    const pendingAmount = pending.pendingAmount || 0;
    const totalCount = overall.totalCount || 0;

    const cashPercent =
      totalPurchases > 0
        ? Math.round((totalCashPaid / totalPurchases) * 100)
        : 0;

    const summary = {
      totalPurchases,
      totalCashPaid,
      totalCredit,
      approvedCount,
      creditBillsCount,
      totalUnits,
      uniqueProductsCount,
      priceUpdatesCount,
      pendingCount,
      pendingAmount,
      totalCount,
      cashPercent,
    };

    return ApiResponse(
      res,
      200,
      true,
      "Supplier purchase summary calculated successfully",
      summary,
    );
  } catch (error: any) {
    console.error("Error calculating supplier purchase summary:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};
