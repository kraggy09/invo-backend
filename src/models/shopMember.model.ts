import mongoose, { Schema, Types, Document } from "mongoose";

export interface IShopMember extends Document {
  shop: Types.ObjectId;
  user: Types.ObjectId;
  roles: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const shopMemberSchema = new Schema<IShopMember>(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    roles: {
      type: [String],
      default: ["WORKER"],
      enum: ["PLATFORM_ADMIN", "SUPER_ADMIN", "ADMIN", "WORKER", "SPECIAL_RIGHTS"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Compound unique: one membership record per user per shop
shopMemberSchema.index({ shop: 1, user: 1 }, { unique: true });
// Fast lookup: all shops for a user
shopMemberSchema.index({ user: 1 });

const ShopMember = mongoose.model<IShopMember>("ShopMember", shopMemberSchema);

export default ShopMember;
