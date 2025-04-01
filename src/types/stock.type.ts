import { Document, Types } from "mongoose";

export interface IStock extends Document {
  date: Date;
  createdBy: Types.ObjectId;
  approvedBy: Types.ObjectId;
  product?: Types.ObjectId;
  oldStock: number;
  quantity: number;
  stockAtUpdate: number;
  newStock: number;
  purpose: "STOCK_UPDATE" | "PRODUCT_RETURN";
}
