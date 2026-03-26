import axios from "axios";
import { Request, Response } from "express";
import Product from "../models/product.model";
import ApiResponse from "../utils/ApiResponse";
import {
  ApiError,
  getCurrentDateAndTime,
  getDate,
  getServerErrorLog,
} from "../utils";
import mongoose from "mongoose";
import Counter from "../models/counter.model";
import Customer from "../models/customer.model";
import Transaction from "../models/transaction.model";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import Stock from "../models/stock.model";
import moment from "moment-timezone";
import { EVENTS_MAP } from "../constant/redisMap";
import { journeyQueue } from "../queues/journeyQueue";

const IST = "Asia/Kolkata"; // Update with the correct path

export const createNewProduct = async (req: Request, res: Response) => {
  try {
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
      const existingProduct = await Product.findOne({ idempotencyKey });
      if (existingProduct) {
        return ApiResponse(res, 200, true, `Product already exists (Idempotent)`, {
          product: existingProduct,
        });
      }
    }
    const requiredFields = [
      "name",
      "category",
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
      (field) => !req.body[field] || req.body[field].toString().trim() === ""
    );

    if (missingFields.length > 0) {
      return ApiResponse(
        res,
        400,
        false,
        `Missing required field(s): ${missingFields.join(", ")}`
      );
    }

    // Sanitize fields where applicable
    name = name.trim().toLowerCase();
    category = category.trim().toLowerCase();

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
    const productBarcode = await Product.findOne({
      barcode: { $in: barcode },
    });
    const productName = await Product.findOne({ name });

    // Check if barcode already exists
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

    // Check if product name already exists
    if (productName) {
      return ApiResponse(res, 409, false, `Product already exists`, {
        product: productName,
      });
    }

    // Create new product
    const newProduct = await Product.create({
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
      category,
      idempotencyKey,
    });

    const io = req.app.get("io");
    if (io) {
      io.emit(EVENTS_MAP.PRODUCT_CREATED, newProduct);
    }

    journeyQueue.add("product-created", {
      journeyLog: {
        eventType: "PRODUCT_CREATED",
        message: `Product ${newProduct.name} created`,
        createdBy: (req as any).user?._id || null,
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

export const getProduct = async (req: Request, res: Response) => {
  try {
    const { name, barcode } = req.query;
    const { id } = req.params;

    if (id) {
      const product = await Product.findById(id);
      if (product) {
        return ApiResponse(res, 200, true, "The product is found", {
          product: [product],
        });
      }
    }

    if (name) {
      const product = await Product.find({ name });
      if (product && product.length > 0) {
        return ApiResponse(res, 200, true, "The product is found", {
          product,
        });
      }
    }

    if (barcode) {
      const product = await Product.findOne({ barcode });
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

export const getAllproduct = async (req: Request, res: Response) => {
  try {
    const products = await Product.find().sort({ name: 1 });

    return ApiResponse(res, 200, true, "These are the products", {
      products,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message);
  }
};

export const updateProductDetails = async (req: Request, res: Response) => {
  try {
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

    const updatedData: any = {
      name: name.trim(),
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
      barcode,
    };

    if (!Array.isArray(barcode)) {
      updatedData.barcode = [barcode];
    }

    const existingProduct = await Product.findOne({
      _id: { $ne: id || productId },
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

    const previousProduct = await Product.findById(id || productId);

    const updatedProduct = await Product.findByIdAndUpdate(
      id || productId,
      { $set: updatedData },
      { new: true }
    );

    if (!updatedProduct) {
      return ApiResponse(res, 404, false, "Product not found");
    }

    const io = req.app.get("io");
    if (io) {
      io.emit(EVENTS_MAP.PRODUCT_UPDATED, updatedProduct);
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
      journeyLog: {
        eventType: "PRODUCT_UPDATED",
        message: changes.length > 0
          ? `Product ${updatedProduct.name} updated: ${changes.join(", ")}`
          : `Product ${updatedProduct.name} updated`,
        createdBy: (req as any).user?._id || null,
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

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const productId = req.params;
    if (productId) {
      const deletedProduct = await Product.findByIdAndDelete(
        productId.id || Object.values(productId)[0]
      );
      if (deletedProduct) {
        const io = req.app.get("io");
        if (io) {
          io.emit(EVENTS_MAP.PRODUCT_DELETED, deletedProduct._id);
        }

        journeyQueue.add("product-deleted", {
          journeyLog: {
            eventType: "PRODUCT_DELETED",
            message: `Product ${deletedProduct.name} deleted`,
            createdBy: (req as any).user?._id || null,
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