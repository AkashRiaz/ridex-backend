import { redisClient } from "../lib/redis";

/*
 * Fixed-window counter in Redis: `<purpose>:<identifier>`.
 * Returns false once `limit` is exceeded inside the window.
 * Fails open: Redis trouble never blocks a user.
 */
export const consumeRateLimit = async (
  key: string,
  limit: number,
  windowSeconds: number,
  cost = 1,
) => {
  try {
    const count = await redisClient.incrBy(key, cost);

    if (count === cost) await redisClient.expire(key, windowSeconds);

    return count <= limit;
  } catch (error) {
    console.error(`Rate limit check failed for ${key}:`, error);
    return true;
  }
};
