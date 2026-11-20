import { createClient } from "redis";
import { config } from "../config";

export const redisClient = createClient({
  username: config.redis_user,
  password: config.redis_password,
  // RESP2 works with every Redis server version (RESP3 needs Redis 6+)
  RESP: 2,
  socket: {
    host: config.redis_host,
    port: Number(config.redis_port),
  },
});

redisClient.on("error", (error) => {
  console.error("Redis client error:", error);
});
