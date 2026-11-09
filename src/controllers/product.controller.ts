import mongoose from "mongoose";
import axios from "axios";
import { Response } from "express";
import Product from "../models/product.model";
import Shop from "../models/shop.model";
import PriceHistory from "../models/priceHistory.model";
import Supplier from "../models/supplier.model";
import SupplierPurchase from "../models/supplierPurchase.model";
import Stock from "../models/stock.model";
import Transaction from "../models/transaction.model";
import Counter from "../models/counter.model";
import ApiResponse from "../utils/ApiResponse";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";

import { EVENTS_MAP } from "../constant/redisMap";
import { journeyQueue } from "../queues/journeyQueue";

const IST = "Asia/Kolkata"; // Update with the correct path

export const createNewProduct = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const userId = req.user?.id || req.user?._id;

    const adminRoles = ["SUPER_ADMIN", "ADMIN", "CREATOR"];
    const userRoles = req.shopMember?.roles || req.user?.roles || [];
    const isAdmin = userRoles.some((role: string) => adminRoles.includes(role));

    let {
      name,
      category,
      barcode,
      mrp,
      costPrice,
      retailPrice,
      wholesalePrice,
      superWholesalePrice,
      measuring,
      stock,
      packet,
      box,
      minQuantity,
      idempotencyKey,
      supplierId,
      paymentMode,
      isAutoBarcode,
    } = req.body;

    if (idempotencyKey) {
      const existingProduct = await Product.findOne({ shopId, idempotencyKey });
      if (existingProduct) {
        return ApiResponse(res, 200, true, `Product already exists (Idempotent)`, {
          product: existingProduct,
        });
      }
    }

    let supplierDoc: any = null;
    if (supplierId) {
      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return ApiResponse(res, 400, false, "Invalid supplier ID");
      }
      supplierDoc = await Supplier.findOne({ _id: supplierId, shopId });
      if (!supplierDoc) {
        return ApiResponse(res, 404, false, "Supplier not found");
      }
    }

    const shop = await Shop.findById(shopId).select("settings");
    const isRetailOnly = shop?.settings?.pricingMode === "RETAIL_ONLY";
    const currentShopBarcode = shop?.settings?.currentBarcode ?? 1000;

    if ((barcode === undefined || barcode === null || (Array.isArray(barcode) && barcode.length === 0)) && isAutoBarcode) {
      barcode = [currentShopBarcode];
    }

    const requiredFields = isRetailOnly
      ? [
          "name",
          "barcode",
          "mrp",
          "costPrice",
          "retailPrice",
          "measuring",
          "stock",
          "minQuantity",
        ]
      : [
          "name",
          "barcode",
          "mrp",
          "costPrice",
          "retailPrice",
          "wholesalePrice",
          "superWholesalePrice",
          "measuring",
          "stock",
          "packet",
          "box",
          "minQuantity",
        ];

    // Check if all required fields are present and sanitized
    const missingFields = requiredFields.filter(
      (field) => req.body[field] === undefined || req.body[field] === null || req.body[field].toString().trim() === ""
    );

    if (missingFields.length > 0) {
      return ApiResponse(
        res,
        400,
        false,
        `Missing required field(s): ${missingFields.join(", ")}`
      );
    }

    if (isRetailOnly) {
      wholesalePrice =
        wholesalePrice !== undefined && wholesalePrice !== null && wholesalePrice !== ""
          ? Number(wholesalePrice)
          : Number(retailPrice);
      superWholesalePrice =
        superWholesalePrice !== undefined && superWholesalePrice !== null && superWholesalePrice !== ""
          ? Number(superWholesalePrice)
          : Number(retailPrice);
      packet = packet !== undefined && packet !== null && packet !== "" ? Number(packet) : 0;
      box = box !== undefined && box !== null && box !== "" ? Number(box) : 0;
    }

    // Sanitize category: if empty, "null", or "none", store as null
    const sanitizedCategory =
      category &&
      typeof category === "string" &&
      category.trim() !== "" &&
      category.trim().toLowerCase() !== "null" &&
      category.trim().toLowerCase() !== "none"
        ? category.trim().toLowerCase()
        : null;

    let newOne: any;
    const get_base_url = (lang: "hi", word: string) =>
      `https://www.google.com/inputtools/request?ime=transliteration_en_${lang}&num=5&cp=0&cs=0&ie=utf-8&oe=utf-8&app=jsapi&text=${word}`;

    try {
      const res = await axios.get(get_base_url("hi", name));

      if (res.data[1][0][1]?.length > 0) {
        newOne = [...res.data[1][0][1], name];
      } else {
        console.log(name);
      }
    } catch (error: any) {
      console.log(error.message);
    }

    if (!Array.isArray(barcode)) {
      barcode = [barcode];
    }
    name = name.toLowerCase();

    const numericBarcodes = barcode.map((b: any) => Number(b));
    const isShopAutoBarcode = Boolean(
      isAutoBarcode || numericBarcodes.includes(Number(currentShopBarcode))
    );

    // Barcode and name uniqueness is scoped PER SHOP
    const productBarcode = await Product.findOne({
      shopId,
      barcode: { $in: barcode },
    });
    const productName = await Product.findOne({ shopId, name });

    // Check if barcode already exists within this shop
    if (productBarcode) {
      return ApiResponse(
        res,
        409,
        false,
        `The barcode is already being used by the product`,
        {
          product: productBarcode,
        }
      );
    }

    // Check if product name already exists within this shop
    if (productName) {
      return ApiResponse(res, 409, false, `Product already exists`, {
        product: productName,
      });
    }

    const requestedStock = Number(stock) || 0;
    // If user is not admin and stock > 0, stock is initialized to 0 pending admin approval
    const initialStock = !isAdmin && requestedStock > 0 ? 0 : requestedStock;

    const session = await mongoose.startSession();
    let newProduct: any = null;
    let purchaseDoc: any = null;
    let createdTx: any = null;
    let stockDoc: any = null;
    let nextBarcodeValue = currentShopBarcode;

    try {
      await session.withTransaction(async () => {
        // Create new product with shopId
        const createdProducts = await Product.create(
          [
            {
              shopId,
              name,
              barcode,
              mrp,
              costPrice,
              retailPrice,
              wholesalePrice,
              superWholesalePrice,
              measuring,
              stock: initialStock,
              packet,
              box,
              minQuantity,
              hi: newOne ? newOne[0] : name,
              category: sanitizedCategory,
              idempotencyKey,
            },
          ],
          { session }
        );
        newProduct = createdProducts[0];

        // Increment shop-wide auto barcode sequence if auto barcode was used
        if (isShopAutoBarcode) {
          nextBarcodeValue = currentShopBarcode + 1;
          while (await Product.findOne({ shopId, barcode: nextBarcodeValue }).session(session)) {
            nextBarcodeValue++;
          }
          await Shop.findByIdAndUpdate(
            shopId,
            { $set: { "settings.currentBarcode": nextBarcodeValue } },
            { session }
          );
        }

        // 1. If Supplier is provided and requested stock > 0
        if (supplierDoc && requestedStock > 0) {
          const totalAmount = requestedStock * Number(costPrice);
          const pMode = paymentMode === "CREDIT" ? "CREDIT" : "CASH";

          if (!isAdmin) {
            // Non-admin user: Create purchase with status "ACCEPTED" awaiting Admin approval
            const createdPurchases = await SupplierPurchase.create(
              [
                {
                  shopId,
                  supplier: supplierDoc._id,
                  status: "ACCEPTED",
                  raisedBy: userId,
                  raisedAt: new Date(),
                  acceptedBy: userId,
                  acceptedAt: new Date(),
                  items: [
                    {
                      product: newProduct._id,
                      quantity: requestedStock,
                      previousCostPrice: Number(costPrice),
                      newCostPrice: Number(costPrice),
                      previousRetailPrice: Number(retailPrice),
                      newRetailPrice: Number(retailPrice),
                      previousWholesalePrice: Number(wholesalePrice || retailPrice),
                      newWholesalePrice: Number(wholesalePrice || retailPrice),
                      previousSuperWholesalePrice: Number(superWholesalePrice || retailPrice),
                      newSuperWholesalePrice: Number(superWholesalePrice || retailPrice),
                      priceUpdated: false,
                    },
                  ],
                  totalAmount,
                  paymentMode: pMode,
                },
              ],
              { session }
            );
            purchaseDoc = createdPurchases[0];
          } else {
            // Admin user: Direct approved purchase with stock and ledger updates
            const cashPaid = pMode === "CASH" ? totalAmount : 0;
            const creditAmount = pMode === "CREDIT" ? totalAmount : 0;
            const prevOutstanding = supplierDoc.outstanding || 0;
            const newOutstanding = prevOutstanding + creditAmount;

            if (creditAmount > 0) {
              supplierDoc.outstanding = newOutstanding;
              await supplierDoc.save({ session });
            }

            const createdPurchases = await SupplierPurchase.create(
              [
                {
                  shopId,
                  supplier: supplierDoc._id,
                  status: "APPROVED",
                  raisedBy: userId,
                  raisedAt: new Date(),
                  acceptedBy: userId,
                  acceptedAt: new Date(),
                  approvedBy: userId,
                  approvedAt: new Date(),
                  items: [
                    {
                      product: newProduct._id,
                      quantity: requestedStock,
                      previousCostPrice: Number(costPrice),
                      newCostPrice: Number(costPrice),
                      previousRetailPrice: Number(retailPrice),
                      newRetailPrice: Number(retailPrice),
                      previousWholesalePrice: Number(wholesalePrice || retailPrice),
                      newWholesalePrice: Number(wholesalePrice || retailPrice),
                      previousSuperWholesalePrice: Number(superWholesalePrice || retailPrice),
                      newSuperWholesalePrice: Number(superWholesalePrice || retailPrice),
                      priceUpdated: false,
                    },
                  ],
                  totalAmount,
                  paymentMode: pMode,
                  cashPaid,
                  creditAmount,
                  previousSupplierOutstanding: prevOutstanding,
                  newSupplierOutstanding: newOutstanding,
                },
              ],
              { session }
            );
            purchaseDoc = createdPurchases[0];

            if (cashPaid > 0) {
              const counter = await Counter.findOneAndUpdate(
                { shopId, name: "transactionId" },
                { $inc: { value: 1 } },
                { session, new: true, upsert: true }
              );

              const createdTxs = await Transaction.create(
                [
                  {
                    shopId,
                    id: counter.value,
                    name: supplierDoc.name,
                    supplier: supplierDoc._id,
                    supplierPurchaseId: purchaseDoc._id,
                    previousOutstanding: prevOutstanding,
                    newOutstanding: prevOutstanding,
                    amount: cashPaid,
                    taken: true,
                    paymentIn: false,
                    purpose: `Supplier Purchase #${String(purchaseDoc._id).slice(-6)} Payment`,
                    approved: true,
                    approvedAt: new Date(),
                    approvedBy: userId,
                    paymentMode: "CASH",
                    date: new Date().toISOString(),
                  },
                ],
                { session }
              );
              createdTx = createdTxs[0];
            }

            // Stock audit log
            const stockDocs = await Stock.create(
              [
                {
                  shopId,
                  date: new Date(),
                  createdBy: userId,
                  actionBy: userId,
                  actionAt: new Date(),
                  product: newProduct._id,
                  oldStock: 0,
                  quantity: requestedStock,
                  stockAtUpdate: 0,
                  newStock: requestedStock,
                  approved: true,
                  rejected: false,
                  purpose: "SUPPLIER_PURCHASE",
                },
              ],
              { session }
            );
            stockDoc = stockDocs[0];

            // Price history record
            await PriceHistory.create(
              [
                {
                  shopId,
                  product: newProduct._id,
                  changedAt: new Date(),
                  changedBy: userId,
                  source: "SUPPLIER_PURCHASE",
                  supplierPurchase: purchaseDoc._id,
                  supplier: supplierDoc._id,
                  previousCostPrice: 0,
                  newCostPrice: Number(costPrice),
                  previousRetailPrice: 0,
                  newRetailPrice: Number(retailPrice),
                  previousWholesalePrice: 0,
                  newWholesalePrice: Number(wholesalePrice || retailPrice),
                  previousSuperWholesalePrice: 0,
                  newSuperWholesalePrice: Number(superWholesalePrice || retailPrice),
                },
              ],
              { session }
            );
          }
        } else if (!supplierDoc && requestedStock > 0) {
          // 2. No supplier specified, but initial stock entered
          if (!isAdmin) {
            // Non-admin: Create stock update request awaiting Admin approval
            const stockDocs = await Stock.create(
              [
                {
                  shopId,
                  createdBy: userId,
                  approved: false,
                  rejected: false,
                  product: newProduct._id,
                  oldStock: 0,
                  quantity: requestedStock,
                  newStock: requestedStock,
                  purpose: "STOCK_UPDATE",
                },
              ],
              { session }
            );
            stockDoc = stockDocs[0];
          } else {
            // Admin: Direct stock audit log
            const stockDocs = await Stock.create(
              [
                {
                  shopId,
                  date: new Date(),
                  createdBy: userId,
                  actionBy: userId,
                  actionAt: new Date(),
                  product: newProduct._id,
                  oldStock: 0,
                  quantity: requestedStock,
                  stockAtUpdate: 0,
                  newStock: requestedStock,
                  approved: true,
                  rejected: false,
                  purpose: "STOCK_UPDATE",
                },
              ],
              { session }
            );
            stockDoc = stockDocs[0];
          }
        }
      });
    } finally {
      session.endSession();
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.PRODUCT_CREATED, newProduct);

      if (purchaseDoc && supplierDoc) {
        const user = req.user;
        const populatedPurchase = {
          ...purchaseDoc.toObject(),
          supplier: {
            _id: supplierDoc._id,
            name: supplierDoc.name,
            phone: supplierDoc.phone,
            outstanding: supplierDoc.outstanding,
          },
          raisedBy: user
            ? { _id: user._id, name: user.name, username: user.username }
            : { _id: userId },
          acceptedBy: user
            ? { _id: user._id, name: user.name, username: user.username }
            : { _id: userId },
          approvedBy: isAdmin && user
            ? { _id: user._id, name: user.name, username: user.username }
            : undefined,
          items: [
            {
              ...purchaseDoc.items[0].toObject(),
              product: {
                _id: newProduct._id,
                name: newProduct.name,
                barcode: newProduct.barcode,
                measuring: newProduct.measuring,
                mrp: newProduct.mrp,
                costPrice: newProduct.costPrice,
                retailPrice: newProduct.retailPrice,
                wholesalePrice: newProduct.wholesalePrice,
                superWholesalePrice: newProduct.superWholesalePrice,
                stock: newProduct.stock,
                packet: newProduct.packet,
                box: newProduct.box,
              },
            },
          ],
        };

        io.to(`shop:${shopId}`).emit(
          EVENTS_MAP.SUPPLIER_PURCHASE_CREATED,
          populatedPurchase
        );

        if (!isAdmin) {
          io.to(`shop:${shopId}`).emit(
            EVENTS_MAP.SUPPLIER_PURCHASE_ACCEPTED,
            populatedPurchase
          );
        } else {
          io.to(`shop:${shopId}`).emit(
            EVENTS_MAP.SUPPLIER_PURCHASE_APPROVED,
            populatedPurchase
          );

          if (stockDoc) {
            const stockPayload = {
              action: "acceptAll",
              data: {
                updatedProducts: [
                  {
                    productId: newProduct._id.toString(),
                    previousStock: 0,
                    newStock: requestedStock,
                    quantityAdded: requestedStock,
                    costPrice: newProduct.costPrice,
                    retailPrice: newProduct.retailPrice,
                    wholesalePrice: newProduct.wholesalePrice,
                    superWholesalePrice: newProduct.superWholesalePrice,
                  },
                ],
                stockDocs: [stockDoc],
                updatedRequests: [stockDoc],
              },
            };
            io.to(`shop:${shopId}`).emit("INVENTORY_UPDATED", stockPayload);
            io.to(`shop:${shopId}`).emit(EVENTS_MAP.STOCK_UPDATED, stockPayload);
          }

          if (supplierDoc.outstanding !== undefined) {
            io.to(`shop:${shopId}`).emit(
              EVENTS_MAP.SUPPLIER_UPDATED,
              supplierDoc
            );
          }

          if (createdTx) {
            io.to(`shop:${shopId}`).emit(
              EVENTS_MAP.TRANSACTION_CREATED,
              createdTx
            );
          }
        }
      } else if (!supplierDoc && requestedStock > 0 && !isAdmin && stockDoc) {
        const populatedStockReq = {
          ...stockDoc.toObject(),
          product: { _id: newProduct._id, name: newProduct.name, stock: 0 },
          createdBy: req.user
            ? { _id: req.user._id, name: req.user.name, username: req.user.username }
            : { _id: userId },
        };
        io.to(`shop:${shopId}`).emit("INVENTORY_UPDATE_REQUEST", [populatedStockReq]);
      }

      if (isShopAutoBarcode) {
        io.to(`shop:${shopId}`).emit(EVENTS_MAP.SHOP_SETTINGS_UPDATED, {
          currentBarcode: nextBarcodeValue,
        });
      }
    }

    journeyQueue.add("product-created", {
      shopId: shopId.toString(),
      journeyLog: {
        eventType: "PRODUCT_CREATED",
        message: `Product ${newProduct.name} created`,
        createdBy: req.user?._id || null,
        entityType: "Product",
        entityId: newProduct._id,
        metadata: { mrp: newProduct.mrp, stock: newProduct.stock },
      },
    });

    if (purchaseDoc) {
      journeyQueue.add(isAdmin ? "supplier-purchase-approved" : "supplier-purchase-created", {
        shopId: shopId.toString(),
        journeyLog: {
          eventType: isAdmin ? "SUPPLIER_PURCHASE_APPROVED" : "SUPPLIER_PURCHASE_ACCEPTED",
          message: `Supplier purchase for new product ${newProduct.name} ${isAdmin ? "approved" : "created (accepted)"}`,
          createdBy: userId,
          entityType: "SupplierPurchase",
          entityId: purchaseDoc._id,
          metadata: {
            supplierId: supplierDoc?._id,
            totalAmount: purchaseDoc.totalAmount,
            status: purchaseDoc.status,
          },
        },
      });
    }

    let successMessage = "Product created successfully";
    if (!isAdmin && requestedStock > 0) {
      successMessage = supplierDoc
        ? "Product created. Supplier purchase request sent to Admin for approval."
        : "Product created. Stock update request sent to Admin for approval.";
    }

    // Return response
    return ApiResponse(res, 201, true, successMessage, {
      product: newProduct,
      purchase: purchaseDoc,
      currentBarcode: isShopAutoBarcode ? nextBarcodeValue : currentShopBarcode,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, `Internal Server Error`, {
      error: error.message,
    });
  }
};

export const getProduct = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const { name, barcode } = req.query;
    const { id } = req.params;

    if (id) {
      const product = await Product.findOne({ _id: id, shopId });
      if (product) {
        return ApiResponse(res, 200, true, "The product is found", {
          product: [product],
        });
      }
    }

    if (name) {
      const product = await Product.find({ shopId, name });
      if (product && product.length > 0) {
        return ApiResponse(res, 200, true, "The product is found", {
          product,
        });
      }
    }

    if (barcode) {
      const product = await Product.findOne({ shopId, barcode });
      if (product) {
        return ApiResponse(res, 200, true, "The product is found", {
          data: product,
        });
      }
    }

    return ApiResponse(res, 404, false, "No data found for this product");
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getAllproduct = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const products = await Product.find({ shopId }).sort({ name: 1 });

    return ApiResponse(res, 200, true, "These are the products", {
      products,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message);
  }
};

export const updateProductDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const product = req.body;
    const { id } = req.params;
    const {
      productId,
      barcode,
      name,
      category,
      mrp,
      costPrice,
      measuring,
      retailPrice,
      wholesalePrice,
      superWholesalePrice,
      packet,
      box,
      minQuantity,
    } = product;

    const shop = await Shop.findById(shopId).select("settings");
    const isRetailOnly = shop?.settings?.pricingMode === "RETAIL_ONLY";

    const sanitizedCategory =
      category &&
      typeof category === "string" &&
      category.trim() !== "" &&
      category.trim().toLowerCase() !== "null" &&
      category.trim().toLowerCase() !== "none"
        ? category.trim().toLowerCase()
        : null;

    const updatedData: any = {
      name: name.trim(),
      category: sanitizedCategory,
      mrp,
      costPrice,
      measuring,
      retailPrice,
      wholesalePrice: isRetailOnly && (wholesalePrice == null || wholesalePrice === "") ? retailPrice : wholesalePrice,
      superWholesalePrice: isRetailOnly && (superWholesalePrice == null || superWholesalePrice === "") ? retailPrice : superWholesalePrice,
      packet: isRetailOnly && (packet == null || packet === "") ? 0 : packet,
      box: isRetailOnly && (box == null || box === "") ? 0 : box,
      minQuantity,
      barcode,
    };

    if (!Array.isArray(barcode)) {
      updatedData.barcode = [barcode];
    }

    // Check barcode conflicts WITHIN this shop only
    const existingProduct = await Product.findOne({
      _id: { $ne: id || productId },
      shopId,
      barcode: { $in: updatedData.barcode },
    });

    if (existingProduct) {
      return ApiResponse(
        res,
        409,
        false,
        "One or more barcodes are already in use by another product",
        {
          existingProduct,
        }
      );
    }

    const previousProduct = await Product.findOne({ _id: id || productId, shopId });

    const updatedProduct = await Product.findOneAndUpdate(
      { _id: id || productId, shopId },
      { $set: updatedData },
      { new: true }
    );

    if (!updatedProduct) {
      return ApiResponse(res, 404, false, "Product not found");
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.PRODUCT_UPDATED, updatedProduct);
    }

    const changes: string[] = [];
    const changeMetadata: any = {
      before: {},
      after: {}
    };

    if (previousProduct) {
      const prevCp = Number(previousProduct.costPrice) || 0;
      const prevRetail = Number(previousProduct.retailPrice) || 0;
      const prevWholesale = Number(previousProduct.wholesalePrice) || 0;
      const prevSuperWholesale = Number(previousProduct.superWholesalePrice) || 0;

      const newCp = updatedProduct.costPrice !== undefined ? Number(updatedProduct.costPrice) : prevCp;
      const newRetail = updatedProduct.retailPrice !== undefined ? Number(updatedProduct.retailPrice) : prevRetail;
      const newWholesale = updatedProduct.wholesalePrice !== undefined ? Number(updatedProduct.wholesalePrice) : prevWholesale;
      const newSuperWholesale = updatedProduct.superWholesalePrice !== undefined ? Number(updatedProduct.superWholesalePrice) : prevSuperWholesale;

      const hasPriceChanged =
        prevCp !== newCp ||
        prevRetail !== newRetail ||
        prevWholesale !== newWholesale ||
        prevSuperWholesale !== newSuperWholesale;

      if (hasPriceChanged) {
        PriceHistory.create({
          shopId,
          product: updatedProduct._id,
          changedAt: new Date(),
          changedBy: req.user?._id || req.user?.id,
          source: "MANUAL_EDIT",
          previousCostPrice: prevCp,
          newCostPrice: newCp,
          previousRetailPrice: prevRetail,
          newRetailPrice: newRetail,
          previousWholesalePrice: prevWholesale,
          newWholesalePrice: newWholesale,
          previousSuperWholesalePrice: prevSuperWholesale,
          newSuperWholesalePrice: newSuperWholesale,
        }).catch((err) => console.error("Error creating manual price history:", err));
      }

      Object.keys(updatedData).forEach((key) => {
        const oldValue = (previousProduct as any)[key];
        const newValue = updatedData[key];

        if (Array.isArray(newValue)) {
          if (JSON.stringify(newValue.sort()) !== JSON.stringify(oldValue?.sort())) {
            changes.push(`${key} changed`);
            changeMetadata.before[key] = oldValue;
            changeMetadata.after[key] = newValue;
          }
        } else if (oldValue !== newValue) {
          changes.push(`${key}: ${oldValue} -> ${newValue}`);
          changeMetadata.before[key] = oldValue;
          changeMetadata.after[key] = newValue;
        }
      });
    }

    journeyQueue.add("product-updated", {
      shopId: shopId.toString(),
      journeyLog: {
        eventType: "PRODUCT_UPDATED",
        message: changes.length > 0
          ? `Product ${updatedProduct.name} updated: ${changes.join(", ")}`
          : `Product ${updatedProduct.name} updated`,
        createdBy: req.user?._id || null,
        entityType: "Product",
        entityId: updatedProduct._id,
        metadata: {
          ...changeMetadata,
          currentStock: updatedProduct.stock,
        }
      }
    });

    return ApiResponse(res, 200, true, "Product Updated Successfully", {
      product: updatedProduct,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Internal Server Error", {
      error: error.message || "Server Error",
    });
  }
};

export const deleteProduct = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const { id } = req.params;
    if (id) {
      const deletedProduct = await Product.findOneAndDelete({ _id: id, shopId });
      if (deletedProduct) {
        const io = req.app.get("io");
        if (io) {
          io.to(`shop:${shopId}`).emit(EVENTS_MAP.PRODUCT_DELETED, deletedProduct._id);
        }

        journeyQueue.add("product-deleted", {
          shopId: shopId.toString(),
          journeyLog: {
            eventType: "PRODUCT_DELETED",
            message: `Product ${deletedProduct.name} deleted`,
            createdBy: req.user?._id || null,
            entityType: "Product",
            entityId: deletedProduct._id
          }
        });
        return ApiResponse(res, 201, true, "Product deleted successfully");
      }
    }

    return ApiResponse(res, 404, false, "Product not found");
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server error");
  }
};

export const getProductPriceHistory = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const shopId = req.shopId!;
    const { id } = req.params;
    const { page = 1, limit = 15 } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 15));
    const skip = (pageNum - 1) * limitNum;

    const query = { shopId, product: id };

    const [priceHistories, total] = await Promise.all([
      PriceHistory.find(query)
        .populate("changedBy", "name username")
        .populate("supplier", "name")
        .sort({ changedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PriceHistory.countDocuments(query),
    ]);

    return ApiResponse(res, 200, true, "Price history fetched successfully", {
      priceHistories,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    console.error("Error fetching price history:", error);
    return ApiResponse(res, 500, false, error.message || "Server error");
  }
};