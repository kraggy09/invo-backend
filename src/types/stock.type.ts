import { Document, Types } from "mongoose";

export interface IStock extends Document {
  shopId: Types.ObjectId;
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
  purpose:
    | "STOCK_UPDATE"
    | "PRODUCT_RETURN"
    | "SUPPLIER_PURCHASE"
    | "STOCK_RECONCILIATION";
  reason?: string;
  returnBill?: Types.ObjectId;
  actionAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
