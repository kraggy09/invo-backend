import { Document, Types } from "mongoose";
export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  username: string;
  password: string;
  pin?: string;
  roles?: string[];
}
