import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { prisma } from "../src/app/lib/prisma";
import { redisClient } from "../src/app/lib/redis";
import { otpKeys } from "../src/app/module/auth/auth.utils";
import { Role } from "../src/generated/prisma/enums";

/*
 * End-to-end auth + user flow.
 * Runs only when DATABASE_URL_TEST is set (see vitest.config.ts).
 * Uses the configured Redis; every key it touches is unique to this run.
 */
const isIntegration = process.env.RIDEX_INTEGRATION === "true";

const runId = Date.now();
const TEST_DOMAIN = "ridex.test";
const email = `rider.${runId}@${TEST_DOMAIN}`;
const phone = `+88017${String(runId).slice(-8)}`;
const password = "Ride@2026x";
const newPassword = "Ride@2027y";

const api = "/api/v1";

const getCookie = (res: request.Response, name: string) => {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  return cookie?.split(";")[0].split("=")[1];
};

const clearOtpCooldowns = async (keys: string[]) => {
  await redisClient.del(keys.flatMap((key) => [key, `${key}:cooldown`]));
};

describe.skipIf(!isIntegration)("auth + user flow (integration)", () => {
  let accessToken = "";
  let refreshToken = "";

  beforeAll(async () => {
    await redisClient.connect();
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_DOMAIN}` } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: {
        OR: [{ email: { endsWith: `@${TEST_DOMAIN}` } }, { phone }],
      },
    });
    await clearOtpCooldowns([
      otpKeys.emailVerification(email),
      otpKeys.forgotPassword(email),
      otpKeys.phone("VERIFY", phone),
      otpKeys.phone("LOGIN", phone),
    ]);
    await redisClient.quit();
    await prisma.$disconnect();
  });

  it("registers an unverified user", async () => {
    const res = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "Test Rider", email, password, role: "SELLER" });

    expect(res.status).toBe(201);
    expect(res.body.data.user.password).toBeUndefined();
    expect(res.body.data.verification.email).toBe(true);
  });

  it("rejects duplicate registration", async () => {
    const res = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "Test Rider", email, password, role: "BUYER" });

    expect(res.status).toBe(409);
  });

  it("blocks login until verified", async () => {
    const res = await request(app)
      .post(`${api}/auth/login`)
      .send({ identifier: email, password });

    expect(res.status).toBe(403);
  });

  it("verifies email with the OTP and signs in", async () => {
    const otp = await redisClient.get(otpKeys.emailVerification(email));

    const res = await request(app)
      .post(`${api}/auth/verify-email`)
      .send({ email, otp });

    expect(res.status).toBe(200);
    expect(res.body.data.user.emailVerified).toBe(true);
    expect(getCookie(res, "accessToken")).toBeTruthy();
  });

  it("logs in with email + password", async () => {
    const res = await request(app)
      .post(`${api}/auth/login`)
      .send({ identifier: email.toUpperCase(), password });

    expect(res.status).toBe(200);
    accessToken = res.body.data.accessToken;
    refreshToken = res.body.data.refreshToken;
  });

  it("rejects a wrong password with 401", async () => {
    const res = await request(app)
      .post(`${api}/auth/login`)
      .send({ identifier: email, password: "Wrong@1234" });

    expect(res.status).toBe(401);
  });

  it("returns the current user without the password hash", async () => {
    const res = await request(app)
      .get(`${api}/auth/me`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(email);
    expect(res.body.data.password).toBeUndefined();
  });

  it("rotates refresh tokens and detects reuse", async () => {
    const first = await request(app)
      .post(`${api}/auth/refresh-token`)
      .set("Cookie", `refreshToken=${refreshToken}`);

    expect(first.status).toBe(200);
    const rotated = first.body.data.refreshToken;
    expect(rotated).not.toBe(refreshToken);

    // replaying the old token revokes every session
    const replay = await request(app)
      .post(`${api}/auth/refresh-token`)
      .set("Cookie", `refreshToken=${refreshToken}`);
    expect(replay.status).toBe(401);

    const afterReuse = await request(app)
      .post(`${api}/auth/refresh-token`)
      .set("Cookie", `refreshToken=${rotated}`);
    expect(afterReuse.status).toBe(401);
  });

  it("change password invalidates old access tokens", async () => {
    const login = await request(app)
      .post(`${api}/auth/login`)
      .send({ identifier: email, password });
    const oldAccessToken = login.body.data.accessToken;

    const change = await request(app)
      .post(`${api}/auth/change-password`)
      .set("Authorization", `Bearer ${oldAccessToken}`)
      .send({ oldPassword: password, newPassword });

    expect(change.status).toBe(200);

    const withOld = await request(app)
      .get(`${api}/auth/me`)
      .set("Authorization", `Bearer ${oldAccessToken}`);
    expect(withOld.status).toBe(401);

    const withNew = await request(app)
      .get(`${api}/auth/me`)
      .set("Authorization", `Bearer ${change.body.data.accessToken}`);
    expect(withNew.status).toBe(200);
  });

  it("resets a forgotten password with an OTP", async () => {
    const forgot = await request(app)
      .post(`${api}/auth/forgot-password`)
      .send({ identifier: email });
    expect(forgot.status).toBe(200);

    const otp = await redisClient.get(otpKeys.forgotPassword(email));

    const reset = await request(app)
      .post(`${api}/auth/reset-password`)
      .send({ identifier: email, otp, newPassword: password });
    expect(reset.status).toBe(200);

    const login = await request(app)
      .post(`${api}/auth/login`)
      .send({ identifier: email, password });
    expect(login.status).toBe(200);
    accessToken = login.body.data.accessToken;
  });

  it("updates my profile", async () => {
    const res = await request(app)
      .patch(`${api}/users/me`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ bio: "Weekend rider", district: "Dhaka" });

    expect(res.status).toBe(200);
    expect(res.body.data.bio).toBe("Weekend rider");
  });

  it("registers with phone, verifies, then logs in with a phone OTP", async () => {
    const register = await request(app)
      .post(`${api}/auth/register`)
      .send({ name: "Phone Rider", phone: `0${phone.slice(4)}`, password, role: "BUYER" });
    expect(register.status).toBe(201);
    expect(register.body.data.user.phone).toBe(phone);

    const verifyOtp = await redisClient.get(otpKeys.phone("VERIFY", phone));
    const verify = await request(app)
      .post(`${api}/auth/phone-otp/verify`)
      .send({ phone, otp: verifyOtp, purpose: "VERIFY" });
    expect(verify.status).toBe(200);
    expect(verify.body.data.user.phoneVerified).toBe(true);

    const send = await request(app)
      .post(`${api}/auth/phone-otp/send`)
      .send({ phone, purpose: "LOGIN" });
    expect(send.status).toBe(200);

    const loginOtp = await redisClient.get(otpKeys.phone("LOGIN", phone));
    const login = await request(app)
      .post(`${api}/auth/phone-otp/verify`)
      .send({ phone, otp: loginOtp, purpose: "LOGIN" });
    expect(login.status).toBe(200);
  });

  describe("admin user management", () => {
    let adminToken = "";
    let otherAdminId = "";
    let riderId = "";

    beforeAll(async () => {
      const hashed = await bcrypt.hash(password, 4);

      await prisma.user.create({
        data: {
          name: "Test Admin",
          email: `admin.${runId}@${TEST_DOMAIN}`,
          password: hashed,
          role: Role.ADMIN,
          emailVerified: true,
        },
      });

      const otherAdmin = await prisma.user.create({
        data: {
          name: "Other Admin",
          email: `admin2.${runId}@${TEST_DOMAIN}`,
          password: hashed,
          role: Role.ADMIN,
          emailVerified: true,
        },
      });
      otherAdminId = otherAdmin.id;

      const rider = await prisma.user.findUniqueOrThrow({ where: { email } });
      riderId = rider.id;

      const login = await request(app)
        .post(`${api}/auth/login`)
        .send({ identifier: `admin.${runId}@${TEST_DOMAIN}`, password });
      adminToken = login.body.data.accessToken;
    });

    it("buyers/sellers cannot list users", async () => {
      const res = await request(app)
        .get(`${api}/users`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });

    it("admin lists users with the standard meta", async () => {
      const res = await request(app)
        .get(`${api}/users?searchTerm=${TEST_DOMAIN}&limit=5`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
    });

    it("admin cannot block another admin", async () => {
      const res = await request(app)
        .patch(`${api}/users/${otherAdminId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "BLOCKED", reason: "test" });

      expect(res.status).toBe(403);
    });

    it("blocking a user locks them out immediately", async () => {
      const block = await request(app)
        .patch(`${api}/users/${riderId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "BLOCKED", reason: "Spam listings" });
      expect(block.status).toBe(200);

      const me = await request(app)
        .get(`${api}/auth/me`)
        .set("Authorization", `Bearer ${accessToken}`);
      expect(me.status).toBe(403);

      const login = await request(app)
        .post(`${api}/auth/login`)
        .send({ identifier: email, password });
      expect(login.status).toBe(403);
    });

    it("soft delete hides the user, restore brings them back", async () => {
      const del = await request(app)
        .delete(`${api}/users/${riderId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(del.status).toBe(200);
      expect(del.body.data.isDeleted).toBe(true);

      const restore = await request(app)
        .patch(`${api}/users/${riderId}/restore`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(restore.status).toBe(200);
      expect(restore.body.data.isDeleted).toBe(false);
    });
  });
});
