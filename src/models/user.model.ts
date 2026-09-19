import mongoose, { Schema } from "mongoose";
import { IUser } from "../types/user.type";

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
    pin: {
      type: String,
    },
  },
  { timestamps: true }
);

// Global unique index on username
userSchema.index({ username: 1 }, { unique: true });

const User = mongoose.model<IUser>("User", userSchema);
export default User;
