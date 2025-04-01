import { Document } from "mongoose";
export interface ICategory extends Document {
  name: string;
  wholesale: number;
  superWholeSale: number;
}
