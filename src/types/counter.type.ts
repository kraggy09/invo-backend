import { Document, Types } from "mongoose";

export interface ICounter extends Document {
  shopId: Types.ObjectId;
  name: string;
  value: number;
}
