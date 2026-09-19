import axios from "axios";
import { Response } from "express";
import Product from "../models/product.model";
import Shop from "../models/shop.model";
import ApiResponse from "../utils/ApiResponse";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";

import { EVENTS_MAP } from "../constant/redisMap";
import { journeyQueue } from "../queues/journeyQueue";

const IST = "Asia/Kolkata"; // Update with the correct path

export const createNewProduct = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;

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
    } = req.body;

    if (idempotencyKey) {
      const existingProduct = await Product.findOne({ shopId, idempotencyKey });
      if (existingProduct) {
        return ApiResponse(res, 200, true, `Product already exists (Idempotent)`, {
          product: existingProduct,
        });
      }
    }

    const shop = await Shop.findById(shopId).select("settings");
    const isRetailOnly = shop?.settings?.pricingMode === "RETAIL_ONLY";

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

    let newOne;
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

    // Create new product with shopId
    const newProduct = await Product.create({
      shopId,
      name,
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
      hi: newOne ? newOne[0] : name,
      category: sanitizedCategory,
      idempotencyKey,
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.PRODUCT_CREATED, newProduct);
    }

    journeyQueue.add("product-created", {
      shopId: shopId.toString(),
      journeyLog: {
        eventType: "PRODUCT_CREATED",
        message: `Product ${newProduct.name} created`,
        createdBy: req.user?._id || null,
        entityType: "Product",
        entityId: newProduct._id,
        metadata: { mrp: newProduct.mrp, stock: newProduct.stock }
      }
    });

    // Return response
    return ApiResponse(res, 201, true, `Product created successfully`, {
      product: newProduct,
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