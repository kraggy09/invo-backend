import mongoose, { Schema } from "mongoose";

const aclSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
});

const ACL = mongoose.model("ACL", aclSchema);

export default ACL;
