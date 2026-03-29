import { Request } from "express";
import JourneyLog from "../models/journeyLog.model";
import { EVENTS_MAP } from "../constant/redisMap";
import CustomerJourney from "../models/customerJourney.model";

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

export const addCustomerJourneyLog = async (
    req: Request | any,
    customer: any,
    action: string,
    description: string,
    userId: any,
    amount: number = 0,
    previousOutstanding: number = 0,
    newOutstanding: number = 0,
    entityId?: any,
    metadata?: any
) => {
    if (!customer) {
        console.warn(`⚠️ Skipping customer journey log: 'customer' ID is missing. Action: ${action}`);
        return null;
    }

    try {
        const log = await CustomerJourney.create({
            customer,
            action,
            description,
            user: userId,
            amount,
            previousOutstanding,
            newOutstanding,
            entityId,
            metadata,
        });

        const populatedLog = await log.populate("user", "name username");

        const io = req?.app?.get("io");
        if (io) {
            io.emit(EVENTS_MAP.CUSTOMER_JOURNEY_CREATED, populatedLog);
        }

        return log;
    } catch (error) {
        console.error("Failed to add customer journey log:", error);
        // Don't throw, we don't want logging failure to break main flows
        return null;
    }
};
