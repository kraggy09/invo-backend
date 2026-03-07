import mongoose, { Schema } from "mongoose";
import moment from "moment-timezone";
import { getCurrentDateAndTime } from "../utils";
import { IBill } from "../types/bill.type";

// Set the timezone to IST
const IST = "Asia/Kolkata";

const billSchema = new Schema<IBill>(
  {
    id: {
      type: Number,
      required: true,
      unique: true,
    },
    date: {
      type: Date,
      default: () => moment.tz(getCurrentDateAndTime(), IST),
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    items: [
      {
        previousQuantity: {
          type: Number,
          required: true,
        },
        newQuantity: {
          type: Number,
          required: true,
        },
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        quantity: {
          type: Number,
          required: true,
        },
        discount: {
          type: Number,
          required: true,
        },
        type: {
          type: String,
          required: true,
          enum: ["WHOLESALE", "RETAIL", "SUPERWHOLESALE"],
        },
        total: {
          type: Number,
          required: true,
        },
        costPrice: {
          type: Number,
          required: true,
        },
        productSnapshot: {
          type: Object,
          reuired: true,
        },
      },
    ],
    productsTotal: {
      type: Number,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
    payment: {
      type: Number,
      required: true,
    },
    discount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

billSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

const Bill = mongoose.model("Bill", billSchema);

export default Bill;
