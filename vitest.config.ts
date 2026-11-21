import "dotenv/config";
import { defineConfig } from "vitest/config";

/*
 * Tests NEVER use the real DATABASE_URL.
 * - DATABASE_URL_TEST set   → integration tests run against that database
 * - DATABASE_URL_TEST unset → integration tests are skipped, unit tests still run
 */
const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ||
  "postgresql://invalid:invalid@127.0.0.1:1/ridex_test_disabled";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      RIDEX_INTEGRATION: process.env.DATABASE_URL_TEST ? "true" : "false",
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_SOCKET_SECRET: "test-socket-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      CORS_ORIGINS: "http://localhost:3000",
      // never send real emails or SMS from tests
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      SMS_PROVIDER: "console",
      BCRYPT_SALT_ROUNDS: "4",
      AUTH_RATE_LIMIT_MAX: "1000",
      RATE_LIMIT_MAX: "10000",
    },
  },
});
