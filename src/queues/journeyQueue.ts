import { Queue } from "bullmq";
import redisConnection from "../lib/redis";

export const journeyQueue = new Queue("journey-logs", {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
});

console.log("✅ Journey Queue initialized");
