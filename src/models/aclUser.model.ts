import mongoose, { Schema } from "mongoose";

const aclUser = new Schema({
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
