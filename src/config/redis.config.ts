import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config(); // No need to provide path unless you're loading a custom .env

// Ensure required Redis environment variables are available
const { REDIS_HOST, REDIS_PORT } = process.env;
if (!REDIS_HOST || !REDIS_PORT) {
  console.error("❌ Redis host and port are required in .env file.");
  process.exit(1); // Exit the app if Redis config is not provided
}

// Create Redis client
const redisClient = createClient({
  socket: {
    host: REDIS_HOST,
    port: Number(REDIS_PORT),
  },
});

// Handle Redis connection and error events
redisClient.on("error", (err) => {
  console.error("❌ Redis Error:", err);
});

redisClient.on("connect", () => {
  console.log("✅ Redis Connected");
});

// Create Pub/Sub clients (using duplicate method for separate connection)
const pubClient = redisClient.duplicate();
const subClient = redisClient.duplicate();

// Function to connect Redis and Pub/Sub clients
const connectRedis = async () => {
  try {
    // Connect the main Redis client
    await redisClient.connect();
    console.log("✅ Redis client connected");
    // Connect Pub/Sub clients
    await Promise.all([pubClient.connect(), subClient.connect()]);
    console.log("✅ Redis Pub/Sub Clients Connected");
  } catch (error) {
    console.error("❌ Error connecting to Redis or Pub/Sub Clients:", error);
    process.exit(1); // Exit if there's an error during the connection
  }
};

// Call the connect function
connectRedis();

// Cache Utility Functions
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
