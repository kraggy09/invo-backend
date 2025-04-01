import axios from "axios";
import { Request, Response } from "express";
import Product from "../models/product.model";
import ApiResponse from "../utils/ApiResponse";
import { getDate } from "../utils";
import mongoose from "mongoose";
import Counter from "../models/counter.model";
import Logger from "../models/logger.model";
import Customer from "../models/customer.model";
import Transaction from "../models/transaction.model";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";

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
    } = req.body;
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
      barcode: { $in: updatedData.barcode },
    });

    const existingProductId = existingProduct?._id as string;

    if (existingProduct && existingProductId !== productId) {
      return ApiResponse(
        res,
        409,
        false,
        "Barcode in use for another product",
        {
          existingProduct,
        }
      );
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      productId,
      { $set: updatedData },
      { new: true }
    );

    if (!updatedProduct) {
      return ApiResponse(res, 404, false, "Product not found");
    }

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
    const product = req.params;
    console.log(product);

    if (product.barcode) {
      const deletedProduct = await Product.findOneAndDelete({
        barcode: product.barcode,
      });
      if (deletedProduct) {
        return res.status(200).json({
          success: true,
          data: deletedProduct,
          msg: "Product deleted successfully",
        });
      }
    }

    return res.status(400).json({
      success: false,
      msg: "No product found ",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

export const returnProduct = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const abc = req.body;
  const currentDate = getDate();
  let { purchased, foundCustomer, billId, transactionId, returnType, total } =
    abc;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Validate billId
      const previousBillId = await Counter.findOne({ name: "billId" }).session(
        session
      );
      const previousTransactionId = await Counter.findOne({
        name: "transactionId",
      }).session(session);

      if (!previousBillId || !previousTransactionId) {
        return ApiResponse(
          res,
          404,
          false,
          "TransactionId or BillId not found"
        );
      }

      if (previousBillId.value !== billId) {
        return ApiResponse(res, 400, false, "Duplicate bill !! Pls refresh");
      }

      if (previousTransactionId.value !== transactionId) {
        return ApiResponse(
          res,
          400,
          false,
          "Duplicate Transaction !! Pls refresh"
        );
      }

      if (purchased.length === 0) {
        return ApiResponse(res, 400, false, "No products to return");
      }

      // Prepare bulk operations for product stock updates and logger entries
      const productBulkOperations = [];
      const loggerEntries = [];
      const items = [];

      for (const product of purchased) {
        const quantity =
          product.piece +
          product.packet * product.packetQuantity +
          product.box * product.boxQuantity;

        const id = new mongoose.Types.ObjectId(product.id);

        // Prepare stock update operation
        productBulkOperations.push({
          updateOne: {
            filter: { _id: id },
            update: { $inc: { stock: quantity } },
          },
        });

        // Fetch product details for logging
        const availableProduct = await Product.findById(id).session(session);
        if (!availableProduct) {
          return ApiResponse(
            res,
            404,
            false,
            `Product not found: ${product.name || product.id}`
          );
        }

        // Prepare logger entry
        loggerEntries.push({
          name: "Product Return",
          previousQuantity: availableProduct.stock,
          newQuantity: availableProduct.stock + quantity,
          quantity,
          product: availableProduct._id,
        });

        // Prepare item details for daily report
        items.push({
          product: availableProduct._id,
          quantity,
          previousQuantity: availableProduct.stock,
        });
      }

      // Execute bulk write for product stock updates
      const bulkWriteResult = await Product.bulkWrite(productBulkOperations, {
        session,
      });
      if (bulkWriteResult.modifiedCount !== purchased.length) {
        return ApiResponse(
          res,
          500,
          false,
          "Failed to update all product stocks"
        );
      }

      // Insert logger entries in bulk
      await Logger.insertMany(loggerEntries, { session });

      // Handle return type
      let transaction = null;
      if (returnType === "adjustment") {
        // Fetch and validate customer
        foundCustomer = await Customer.findById(foundCustomer._id).session(
          session
        );
        if (!foundCustomer) {
          return ApiResponse(res, 404, false, "Customer not found");
        }

        const newOutstanding = foundCustomer.outstanding - total;

        let newTransactionId = await Counter.findOneAndUpdate(
          { name: "transactionId" },
          { $inc: { value: 1 } },
          { new: true, session }
        );

        if (!newTransactionId) {
          return ApiResponse(
            res,
            500,
            false,
            "Unable to create transaction id"
          );
        }

        // Create transaction
        transaction = await Transaction.create(
          [
            {
              id: newTransactionId.value,
              name: foundCustomer.name,
              previousOutstanding: foundCustomer.outstanding,
              amount: total,
              newOutstanding,
              approvedBy: req.user._id,
              taken: false,
              purpose: "Return Product",
              paymentMode: "productReturn",
              approved: true,
              customer: foundCustomer._id,
            },
          ],
          { session }
        );

        if (!transaction[0]) {
          return ApiResponse(
            res,
            500,
            false,
            "Unable to create the transaction"
          );
        }

        // Update customer outstanding balance
        const updatedCustomer = await Customer.findByIdAndUpdate(
          foundCustomer._id,
          { $inc: { outstanding: -total } },
          { session }
        );

        if (!updatedCustomer) {
          return ApiResponse(
            res,
            500,
            false,
            "Unable to update customer's outstanding balance"
          );
        }
      } else {
        const newTransactionId = await Counter.findOneAndUpdate(
          { name: "transactionId" },
          { $inc: { value: 1 } },
          { new: true, session }
        );

        if (!newTransactionId) {
          return ApiResponse(
            res,
            500,
            false,
            "Unable to create transaction id"
          );
        }

        transaction = await Transaction.create(
          [
            {
              id: newTransactionId.value,
              name: "Product Return",
              amount: total,
              taken: true,
              purpose: "return",
              paymentMode: "cash",
              approved: true,
            },
          ],
          { session }
        );

        if (!transaction[0]) {
          return ApiResponse(
            res,
            500,
            false,
            "Unable to create the transaction"
          );
        }
      }

      // Update daily report correctly here
      const dailyReport = await DailyReport.findOneAndUpdate(
        { date: currentDate },
        {
          $push: {
            updatedToday: items.map((item) => ({
              product: item.product,
              quantity: item.quantity,
              previousQuantity: item.previousQuantity,
              purpose: "Product Return",
            })),
            transactions: transaction[0]._id,
          },
        },
        { upsert: true, new: true, session }
      );

      if (!dailyReport) {
        return ApiResponse(
          res,
          500,
          false,
          "Unable to update the daily report"
        );
      }

      let newBillId = await Counter.findOneAndUpdate(
        { name: "billId" },
        { $inc: { value: 1 } },
        { new: true, session }
      );

      if (!newBillId) {
        return ApiResponse(res, 500, false, "Unable to create the bill id");
      }

      // Success response
      return ApiResponse(res, 200, true, "Updated successfully", {
        transaction,
        dailyReport,
      });
    });
  } catch (error: any) {
    console.error("Error during transaction:", error.message);
    return ApiResponse(res, 500, false, error.message);
  } finally {
    // End session
    session.endSession();
  }
};
