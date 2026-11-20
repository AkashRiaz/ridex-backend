# Changelog

## [0.1.0] — Foundation (2026-11-20)

### Added
- Project setup from the reference backend: Express 5, Prisma 7 + PostgreSQL (multi-file schema), node-redis, Biome, tsup, tsx.
- Base Prisma models: `User` (email or phone, soft delete, 8 roles), `RefreshToken`, `AuditLog`, and the shared enums.
- Reference helpers: `catchAsync`, `sendResponse`, `AppError`, `jwtUtils`, `hashToken`, `uploadToCloudinary`, `generateRandomPassword`.
- Middleware: `auth(...roles)`, `validateRequest`, `globalErrorHandler`, `notFound`, plus new `globalRateLimiter` and `authRateLimiter`.
- `helper/queryBuilder.ts`: pagination, sort, search and select helpers that return the reference `meta` shape.
- `routes/index.ts` with a `moduleRoutes` array, mounted at `/api/v1`.
- Security: helmet, CORS whitelist (`CORS_ORIGINS`), rate limiting, JSON body size limit, multer file size and type limits.
- Seeds: `seedSuperAdmin` runs on boot. `npm run seed` creates one demo user per role and has placeholders for later steps.
- Vitest + supertest foundation tests. Postman collection skeleton. Documented `.env.example`.

### Changed vs reference (approved fixes, CONVENTIONS.md Part D)
- `auth`: returns 401/403 through `AppError` instead of 500, no longer logs tokens, looks the user up by id only, and rejects tokens issued before a password change.
- `validateRequest`: returns 400 instead of 500, and accepts multipart JSON sent in a `data` field.
- `globalErrorHandler`: P2002 → 409, P2025 → 404. Logs only in development. Hides 5xx messages in production. Handles multer and malformed-JSON errors.
- `notFound`: now uses the standard `{ success, statusCode, message }` error shape.
- Server: real DB check at startup (`SELECT 1`). SMTP is optional in development. Graceful shutdown.
- Redis client uses RESP2 so it works with any Redis server version.
- Biome set to 2-space indentation to match the code style.
