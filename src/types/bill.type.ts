import mongoose from "mongoose";
import { Document } from "mongoose";

export interface IItems extends Document {
  previousQuantity: number;
  newQuantity: number;
  product: mongoose.Types.ObjectId | string;
  quantity: number;
  discount: number;
  type: "WHOLESALE" | "RETAIL" | "SUPER_WHOLESALE";
  total: number;
  costPrice: number;
}

export interface IBill {
  id: number;
  date: Date;
  customer: mongoose.Types.ObjectId | string;
  createdBy: mongoose.Types.ObjectId | string;
  items: IItems[];
  total: number;
  payment: number;
  discount: number;
}
