import redisConnection from "../lib/redis";

const pubClient = redisConnection;
const subClient = redisConnection.duplicate();

export { pubClient, subClient };

