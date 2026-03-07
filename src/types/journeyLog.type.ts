import { Document, Types } from "mongoose";

export interface IJourneyLog extends Document {
    event: string;
    description: string;
    user: Types.ObjectId;
    entityType?: string;
    entityId?: Types.ObjectId;
    metadata?: any;
}
