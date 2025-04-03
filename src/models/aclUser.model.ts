import mongoose, { Schema, Types } from "mongoose";
import { IACL } from "./acl.model";

export interface IACLUser extends Document {
  user: Types.ObjectId; // Refers to User model
  acl: Types.ObjectId | IACL; // Refers to ACL model (can be populated)
}
const aclUser = new Schema<IACLUser>({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  acl: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ACL",
  },
});

const ACLUser = mongoose.model("ACLUser", aclUser);

export default ACLUser;
