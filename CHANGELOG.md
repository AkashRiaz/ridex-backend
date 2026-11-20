# Changelog

## [0.3.0] — Phase 1 · Part 2: vehicleType + brand + vehicleModel (2026-11-20)

### Added
- **Migration `catalog_vehicle_types_brands_models`**:
  - `VehicleType` stores its attribute schema as validated JSON in `attributes`.
  - `Brand`.
  - `BrandVehicleType`, the many-to-many join between brands and vehicle types.
  - `VehicleModel`, with `defaultSpecs` JSON, unique by brand + name and by brand + slug.
- **vehicleType module**:
  - Create, list, get by id or slug, update, and delete. Delete returns 409 while brands or models use the type.
  - `PUT /:id/attributes` replaces the whole schema in one transaction. It is rejected with 409, naming the models, when any model's default specs would become invalid.
  - Attribute types: TEXT, NUMBER, SELECT, MULTI_SELECT, BOOLEAN. Each can set unit, options, min/max/step, required, filterable, showInCard, group, sortOrder, placeholder and helpText.
- **brand module**:
  - CRUD with a multipart logo; the old logo is deleted from Cloudinary when replaced.
  - Linking to vehicle types. A type can't be unlinked while the brand still has models of that type.
  - Filters: `vehicleType`, `isPopular`, `isActive`. Delete returns 409 while the brand has models.
- **vehicleModel module**:
  - CRUD. The brand must be linked to the vehicle type, and `defaultSpecs` are validated against the type's schema (partial).
  - Filters: `brand`, `vehicleType`, `year`, `isActive`.
  - `GET /:idOrSlug?brand=` returns the type's attribute schema too, for auto-fill.
- **Public reads** for every catalog list and detail. Lists show active items only unless `isActive=all` is passed.
- **Helpers**:
  - `buildDynamicSpecSchema` / `validateSpecs`: builds a Zod validator at runtime from an attribute schema. Unknown keys are rejected, form strings are coerced, empty values are dropped, and `partial` mode is supported. Listings will reuse it.
  - `generateSlug` / `generateUniqueSlug` and `isUuid`.
- **Seed** (`npm run seed`): the Bike vehicle type with 20 attributes in 4 groups, 12 brands and 38 models with approximate demo specs. Idempotent, and existing records are never overwritten.
- **Tests**: dynamic spec validation, schema-change conflict detection, attribute schema rules, slugs, and a check that every seeded model is valid.
- **Postman**: Vehicle Types, Brands and Vehicle Models folders.

### Changed
- `uploadToCloudinary` is used with per-entity folders.

## [0.2.0] — Phase 1 · Part 1: auth + user (2026-11-20)

### Added
- **auth module**:
  - Public register (BUYER / SELLER / DEALER; a DEALER starts as `PENDING`).
  - Email verification OTP and phone OTP, for verifying a number and for passwordless login.
  - Login with email or phone plus password.
  - Google login behind `ENABLE_GOOGLE_LOGIN`; unknown emails become BUYER accounts.
  - Refresh-token rotation with reuse detection: replaying an old token revokes every session.
  - Logout, `/me`, change password, and forgot/reset password by email or SMS.
- **user module**:
  - Self-service: `/users/me` (profile and avatar upload through multipart `avatar` + `data`) and soft-delete of your own account.
  - Admin: create staff users (temporary password emailed, `needPasswordChange`), list with search, filters and pagination, get by id, block/unblock with a reason, change role (super admin only), soft delete and restore.
- **Permission guards** (`user.utils.ts`):
  - Nobody can manage their own account through the admin endpoints.
  - SUPER_ADMIN accounts cannot be modified.
  - Only SUPER_ADMIN can manage ADMIN accounts.
  - Allowed roles per creator are listed in `CREATABLE_ROLES`.
- **OTP rules**: 6-digit codes in Redis with a TTL, a resend cooldown, and a maximum number of wrong attempts.
- **Auth rate limit** on every OTP, login and password endpoint (`AUTH_RATE_LIMIT_MAX`).
- **Audit log** entries for login, logout, password change and reset, user create, status change, role change, delete and restore (`utils/auditLogger.ts`).
- **Helpers**:
  - `lib/sms.ts`: SMS adapter; the console provider is used in development.
  - `utils/sendEmail.ts`: the EJS + nodemailer flow in one place.
  - `helper/normalizePhone.ts`: turns BD numbers into the +880 format.
  - `deleteFromCloudinary`.
- **Email templates**: verify-email-otp, forgot-password-otp, password-changed, staff-welcome, plus shared partials.
- **Cron** (`lib/cron.ts`): deletes self-registered accounts with no verified email or phone after `UNVERIFIED_USER_TTL_HOURS` (default 24).
- **Migration `auth_user_fields`**:
  - `User` gains profile fields (bio, gender, dateOfBirth, division/district/area), blocking fields (blockedReason/At/ById) and `createdById`.
  - `RefreshToken` gains `userAgent` and `ipAddress`.
  - New `Gender` enum.
- **Tests**:
  - Unit tests (run without a database): permissions, validation, phone normalization, OTP lifecycle.
  - End-to-end auth and user flow, which runs only when `DATABASE_URL_TEST` is set.
- **Postman**: Auth and Users folders. The collection stores the access token automatically.

### Changed
- `checkAuth`: tokens carry a password version (`pwdAt`), and any token issued before a password change is rejected. This is precise to the millisecond, unlike a comparison with `iat`.
- Auth cookies use `COOKIE_SAME_SITE` and `COOKIE_DOMAIN`, and are `secure` in production or whenever SameSite is `none`.
- `uploadToCloudinary` accepts an optional `{ folder }`.
- `vitest.config.ts` never uses the real `DATABASE_URL`, and tests never send real email or SMS.

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
