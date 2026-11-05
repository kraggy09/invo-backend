import mongoose from "mongoose";
import { Document, Types } from "mongoose";

export interface IItems extends Document {
  previousQuantity: number;
  newQuantity: number;
  product: mongoose.Types.ObjectId | string;
  quantity: number;
  discount: number;
  type: "WHOLESALE" | "RETAIL" | "SUPERWHOLESALE";
  total: number;
  costPrice: number;
}

export interface IBill extends Document {
  shopId: Types.ObjectId;
  id: number;
  date: Date;
  customer: mongoose.Types.ObjectId | string;
  createdBy: mongoose.Types.ObjectId | string;
  items: IItems[];
  productsTotal: number;
  total: number;
  payment: number;
  discount: number;
  idempotencyKey?: string;
  alteredAt?: Date;
  alteredBy?: mongoose.Types.ObjectId | string;
  originalTotalBeforeAlter?: number;
  alterHistory?: Array<{
    alteredAt: Date;
    alteredBy: mongoose.Types.ObjectId | string;
    previousProductsTotal: number;
    previousTotal: number;
    newProductsTotal: number;
    newTotal: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}
