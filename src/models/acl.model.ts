import mongoose, { Schema, Document } from "mongoose";

export interface IACL extends Document {
  name: string;
  description: string;
}

const aclSchema = new Schema<IACL>({
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
