import mongoose, { Schema } from "mongoose";
import moment from "moment-timezone";
import { getCurrentDateAndTime } from "../utils";
import { IBill } from "../types/bill.type";

// Set the timezone to IST
const IST = "Asia/Kolkata";

const billSchema = new Schema<IBill>(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    id: {
      type: Number,
      required: true,
      // No longer globally unique — compound index below
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
    idempotencyKey: {
      type: String,
      sparse: true,
      // No longer globally unique — compound index below
    },
  },
  { timestamps: true },
);

// TTL index for bills older than 60 days
// billSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

// Compound unique indexes for multi-tenancy
billSchema.index({ shopId: 1, id: 1 }, { unique: true });
billSchema.index(
  { shopId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);
billSchema.index({ shopId: 1, customer: 1 });
billSchema.index({ shopId: 1, createdAt: -1 });

const Bill = mongoose.model("Bill", billSchema);

export default Bill;
