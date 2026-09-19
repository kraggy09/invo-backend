import { Document, Types } from "mongoose";
export interface ICategory extends Document {
  shopId: Types.ObjectId;
  name: string;
  wholesale: number;
  superWholeSale: number;
}
