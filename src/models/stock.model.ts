import mongoose, { Schema } from "mongoose";
import moment from "moment-timezone";
import { getCurrentDateAndTime } from "../utils";
import { IStock } from "../types/stock.type";

// Set the timezone to IST
const IST = "Asia/Kolkata";

const stockSchema = new Schema<IStock>(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      default: () => moment.tz(getCurrentDateAndTime(), IST),
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    approved: {
      type: Boolean,
      required: true,
      default: false,
    },
    actionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    actionAt: {
      type: Date,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    oldStock: {
      type: Number,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    stockAtUpdate: {
      type: Number,
    },
    newStock: {
      type: Number,
      required: true,
    },
    purpose: {
      type: String,
      required: true,
      enum: ["PRODUCT_RETURN", "STOCK_UPDATE"],
    },
    rejected: {
      type: Boolean,
      default: false,
      required: true,
    },
    returnBill: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReturnBill",
    },
  },
  { timestamps: true },
);

// TTL index
// stockSchema.index({ createdAt: 1 }, { expireAfterSeconds: 5284000 });

// Compound indexes for multi-tenancy
stockSchema.index({ shopId: 1, product: 1 });
stockSchema.index({ shopId: 1, date: -1 });
stockSchema.index({ shopId: 1, approved: 1 });

const Stock = mongoose.model("Stock", stockSchema);

export default Stock;
