import { Document, Types } from "mongoose";

export interface IPriceHistory extends Document {
  shopId: Types.ObjectId;
  product: Types.ObjectId;
  changedAt: Date;
  changedBy: Types.ObjectId;
  source: "MANUAL_EDIT" | "SUPPLIER_PURCHASE";
  supplierPurchase?: Types.ObjectId;
  supplier?: Types.ObjectId;
  previousCostPrice: number;
  newCostPrice: number;
  previousRetailPrice: number;
  newRetailPrice: number;
  previousWholesalePrice: number;
  newWholesalePrice: number;
  previousSuperWholesalePrice: number;
  newSuperWholesalePrice: number;
  createdAt: Date;
  updatedAt: Date;
}

