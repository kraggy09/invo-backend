import { Document, Types } from "mongoose";

export interface IStock extends Document {
  date: Date;
  createdBy: Types.ObjectId;
  actionBy?: Types.ObjectId;
  product: Types.ObjectId;
  oldStock: number;
  quantity: number;
  stockAtUpdate?: number;
  newStock?: number;
  approved: boolean;
  rejected: boolean;
  purpose: "STOCK_UPDATE" | "PRODUCT_RETURN";
  actionAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
