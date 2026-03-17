import mongoose, { Schema, Document } from "mongoose";

export interface INotification extends Document {
    name: string;
    description: string;
    isCustomer: boolean;
    customerId?: mongoose.Types.ObjectId;
    category: mongoose.Types.ObjectId;
}

const notificationSchema = new Schema<INotification>({
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

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
