import mongoose, { Schema } from "mongoose";
import { IUser } from "../types/user.type";

const userSchema = new Schema<IUser>({
  name: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  pin: {
    type: String,
  },
});

const User = mongoose.model<IUser>("User", userSchema);
export default User;
