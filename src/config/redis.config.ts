import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

const { REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD } = process.env;
if (!REDIS_HOST || !REDIS_PORT || !REDIS_USERNAME || !REDIS_PASSWORD) {
  console.error(
    "❌ Redis host,port,username and password are required in .env file."
  );
  process.exit(1);
}

const redisClient = createClient({
  socket: {
    host: REDIS_HOST,
    port: Number(REDIS_PORT),
  },
  username: REDIS_USERNAME,
  password: REDIS_PASSWORD,
});

redisClient.on("error", (err) => {
  console.error("❌ Redis Error:", err);
});

redisClient.on("connect", () => {
  console.log("✅ Redis Connected");
});

const pubClient = redisClient.duplicate();
const subClient = redisClient.duplicate();
const connectRedis = async () => {
  try {
    await redisClient.connect();
    console.log("✅ Redis client connected");
    await Promise.all([pubClient.connect(), subClient.connect()]);
    console.log("✅ Redis Pub/Sub Clients Connected");
  } catch (error) {
    console.error("❌ Error connecting to Redis or Pub/Sub Clients:", error);
    process.exit(1);
  }
};

connectRedis();

const setCache = async (key: string, value: any, ttl: number) => {
  try {
    await redisClient.set(key, value, { EX: ttl });
    console.log(`✅ Cache set for key: ${key}`);
  } catch (error) {
    console.error(`❌ Error setting cache for key: ${key}`, error);
    return error;
  }
};

const getCache = async (key: string) => {
  try {
    const value = await redisClient.get(key);
    if (value) {
      console.log(`✅ Cache retrieved for key: ${key}`);
      return value;
    } else {
      console.log(`❌ Cache not found for key: ${key}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error retrieving cache for key: ${key}`, error);
    return null;
  }
};

const delCache = async (key: string) => {
  try {
    await redisClient.del(key);
    console.log(`✅ Cache deleted for key: ${key}`);
  } catch (error) {
    console.error(`❌ Error deleting cache for key: ${key}`, error);
  }
};

export { redisClient, pubClient, subClient, setCache, getCache, delCache };
