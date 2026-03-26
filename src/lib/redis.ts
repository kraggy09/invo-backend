import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisConnection = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
});

redisConnection.on("error", (err) => {
    console.error("❌ Shared Redis Connection Error:", err);
});

export default redisConnection;
