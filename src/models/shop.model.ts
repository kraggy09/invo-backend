import mongoose, { Schema, Types, Document } from "mongoose";

export interface IShop extends Document {
  name: string;
  slug: string;
  owner: Types.ObjectId;
  phone?: string;
  address?: string;
  gstin?: string;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  settings: {
    currency: string;
    invoicePrefix: string;
    lowStockAlert: number;
    discordWebhookUrl?: string;
    pricingMode?: "RETAIL_ONLY" | "MULTI_TIER";
    printType?: "A4" | "THERMAL";
  };
  createdAt: Date;
  updatedAt: Date;
}

const shopSchema = new Schema<IShop>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    phone: {
      type: String,
    },
    address: {
      type: String,
    },
    gstin: {
      type: String,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "SUSPENDED"],
      default: "ACTIVE",
    },
    settings: {
      currency: { type: String, default: "INR" },
      invoicePrefix: { type: String, default: "INV" },
      lowStockAlert: { type: Number, default: 10 },
      discordWebhookUrl: { type: String },
      pricingMode: {
        type: String,
        enum: ["RETAIL_ONLY", "MULTI_TIER"],
        default: "MULTI_TIER",
      },
      printType: {
        type: String,
        enum: ["A4", "THERMAL"],
        default: "THERMAL",
      },
    },
  },
  { timestamps: true }
);

const Shop = mongoose.model<IShop>("Shop", shopSchema);

export default Shop;
