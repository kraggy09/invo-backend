import mongoose, { Schema } from "mongoose";
import { IJourneyLog } from "../types/journeyLog.type";

const journeyLogSchema = new Schema<IJourneyLog>(
    {
        shopId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Shop",
            required: true,
            index: true,
        },
        event: {
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
        entityType: {
            type: String,
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
journeyLogSchema.index({ shopId: 1, createdAt: -1 });
journeyLogSchema.index({ shopId: 1, event: 1 });
journeyLogSchema.index({ shopId: 1, entityType: 1, entityId: 1 });

const JourneyLog = mongoose.model("JourneyLog", journeyLogSchema);

export default JourneyLog;
