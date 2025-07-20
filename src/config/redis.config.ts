import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const pubClient = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
});

const subClient = pubClient.duplicate();

export { pubClient, subClient };
