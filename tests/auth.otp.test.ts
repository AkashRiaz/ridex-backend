import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * In-memory stand-in for the node-redis client (only the commands OTP code uses).
 */
const store = new Map<string, { value: string; expiresAt: number }>();

const fakeRedis = {
  get: async (key: string) => {
    const entry = store.get(key);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.value;
  },
  set: async (
    key: string,
    value: string,
    options?: { expiration?: { value: number } },
  ) => {
    store.set(key, {
      value,
      expiresAt: Date.now() + (options?.expiration?.value ?? 3600) * 1000,
    });
  },
  del: async (keys: string[]) => {
    for (const key of keys) store.delete(key);
  },
  ttl: async (key: string) => {
    const entry = store.get(key);
    if (!entry) return -2;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  },
  incr: async (key: string) => {
    const next = Number(store.get(key)?.value ?? 0) + 1;
    store.set(key, { value: String(next), expiresAt: Date.now() + 3600_000 });
    return next;
  },
  expire: async () => true,
};

vi.mock("../src/app/lib/redis", () => ({ redisClient: fakeRedis }));

const { storeOtp, verifyOtp } = await import(
  "../src/app/module/auth/auth.utils"
);

describe("OTP lifecycle", () => {
  beforeEach(() => store.clear());

  it("stores a 6-digit OTP and verifies it once", async () => {
    const { otp } = await storeOtp("test-otp:a");

    expect(otp).toMatch(/^\d{6}$/);
    await expect(verifyOtp("test-otp:a", otp)).resolves.toBeUndefined();

    // consumed — cannot be reused
    await expect(verifyOtp("test-otp:a", otp)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("enforces the resend cooldown", async () => {
    await storeOtp("test-otp:b");

    await expect(storeOtp("test-otp:b")).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("destroys the OTP after too many wrong attempts", async () => {
    const { otp } = await storeOtp("test-otp:c");
    const wrong = otp === "000000" ? "111111" : "000000";

    for (let attempt = 1; attempt < 5; attempt++) {
      await expect(verifyOtp("test-otp:c", wrong)).rejects.toMatchObject({
        statusCode: 400,
      });
    }

    await expect(verifyOtp("test-otp:c", wrong)).rejects.toMatchObject({
      statusCode: 429,
    });

    // even the right code no longer works
    await expect(verifyOtp("test-otp:c", otp)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
