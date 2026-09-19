import mongoose, { Schema } from "mongoose";
import { ICustomerJourney } from "../types/customerJourney.type";

const customerJourneySchema = new Schema<ICustomerJourney>(
    {
        shopId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Shop",
            required: true,
            index: true,
        },
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            required: true,
        },
        action: {
            type: String,
            required: true,
        },
        description: {
            type: String,
            required: true,
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        amount: {
            type: Number,
            default: 0,
        },
        previousOutstanding: {
            type: Number,
            default: 0,
        },
        newOutstanding: {
            type: Number,
            default: 0,
        },
        entityId: {
            type: mongoose.Schema.Types.ObjectId,
        },
        metadata: {
            type: Schema.Types.Mixed,
        },
    },
    { timestamps: true }
);

// Compound indexes for multi-tenancy
customerJourneySchema.index({ shopId: 1, customer: 1, createdAt: -1 });
customerJourneySchema.index({ shopId: 1, action: 1 });

const CustomerJourney = mongoose.model("CustomerJourney", customerJourneySchema);

export default CustomerJourney;
