import mongoose, { Schema } from "mongoose";
import { IJourneyLog } from "../types/journeyLog.type";

const journeyLogSchema = new Schema<IJourneyLog>(
    {
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

// Optional: Add indexes for faster querying
journeyLogSchema.index({ createdAt: -1 });
journeyLogSchema.index({ event: 1 });
journeyLogSchema.index({ entityType: 1, entityId: 1 });

const JourneyLog = mongoose.model("JourneyLog", journeyLogSchema);

export default JourneyLog;
