import mongoose from "mongoose";

export interface ILogger {
  shopId?: mongoose.Types.ObjectId;
  name: string;
  previousQuantity: number;
  quantity: number;
  newQuantity: number;
  product: mongoose.Types.ObjectId;
}
