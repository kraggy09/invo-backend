import mongoose, { Schema, Document } from "mongoose";

export interface INotification extends Document {
    shopId: mongoose.Types.ObjectId;
    name: string;
    description: string;
    isCustomer: boolean;
    customerId?: mongoose.Types.ObjectId;
    category: mongoose.Types.ObjectId;
}

const notificationSchema = new Schema<INotification>({
    shopId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Shop",
        required: true,
        index: true,
    },
    name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    isCustomer: {
        type: Boolean,
        default: false
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer"
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category"
    }
});

// Compound indexes for multi-tenancy
notificationSchema.index({ shopId: 1 });
notificationSchema.index({ shopId: 1, customerId: 1 });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
