import { Request } from "express";
import JourneyLog from "../models/journeyLog.model";
import { EVENTS_MAP } from "../constant/redisMap";

export const addJourneyLog = async (
    req: Request | any,
    event: string,
    description: string,
    userId: any,
    entityType?: string,
    entityId?: any,
    metadata?: any
) => {
    try {
        const log = await JourneyLog.create({
            event,
            description,
            user: userId,
            entityType,
            entityId,
            metadata,
        });

        const populatedLog = await log.populate("user", "name username");

        const io = req?.app?.get("io");
        if (io) {
            io.emit(EVENTS_MAP.JOURNEY_LOG_CREATED, populatedLog);
        }

        return log;
    } catch (error) {
        console.error("Failed to add journey log:", error);
        // Don't throw, we don't want logging failure to break main flows
        return null;
    }
};
