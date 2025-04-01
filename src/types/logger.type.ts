import mongoose from "mongoose";

export interface ILogger {
  name: string;
  previousQuantity: number;
  quantity: number;
  newQuantity: number;
  product: mongoose.Types.ObjectId;
}
