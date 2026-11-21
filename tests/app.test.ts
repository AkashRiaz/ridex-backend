import { Router } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../src/app";
import { auth } from "../src/app/middleware/checkAuth";
import { queryBuilder } from "../src/app/helper/queryBuilder";

describe("app foundation", () => {
  it("GET /health returns success", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
  });

  it("unknown route returns the standard 404 shape", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 404,
      message: "Route not found",
    });
  });

  it("rejects non-whitelisted CORS origins with 403", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "https://evil.example");

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("sets security headers (helmet)", async () => {
    const res = await request(app).get("/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("auth middleware", () => {
  const router = Router();
  router.get("/protected", auth(), (_req, res) => {
    res.json({ ok: true });
  });

  it("returns 401 (not 500) when no token is sent", async () => {
    const { default: express } = await import("express");
    const { globalErrorHandler } = await import(
      "../src/app/middleware/globalErrorHandler"
    );
    const testApp = express().use(router).use(globalErrorHandler);

    const res = await request(testApp).get("/protected");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe("queryBuilder", () => {
  it("clamps pagination and builds meta", () => {
    const { page, limit, skip } = queryBuilder.buildPagination({
      page: "3",
      limit: "500",
    });

    expect({ page, limit, skip }).toEqual({ page: 3, limit: 100, skip: 200 });
    expect(queryBuilder.buildMeta(1, 10, 42)).toEqual({
      page: 1,
      limit: 10,
      total: 42,
      totalPages: 5,
    });
  });

  it("only sorts by allowed fields", () => {
    expect(
      queryBuilder.buildSort({ sortBy: "password", sortOrder: "asc" }, [
        "price",
      ]),
    ).toEqual({ createdAt: "asc" });
  });

  it("builds nested insensitive search", () => {
    expect(queryBuilder.buildSearch("yamaha", ["title", "brand.name"])).toEqual(
      {
        OR: [
          { title: { contains: "yamaha", mode: "insensitive" } },
          { brand: { name: { contains: "yamaha", mode: "insensitive" } } },
        ],
      },
    );
  });
});
