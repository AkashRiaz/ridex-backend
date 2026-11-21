# Changelog

## [0.7.0] — Phase 1 · Part 6: role dashboards + audit log (2026-11-21)

### Added
- **dashboard module** (`/dashboard`): one overview per role. Every overview takes `?range=7d|30d|90d` (default 30d) and returns daily series with one point per local day (0 for empty days).
  - `GET /admin/overview` (super admin, admin):
    - Users by role and status, listings by status, open reports, pending verifications and chat totals, each with change vs the previous period.
    - Daily new users, listings submitted and approved, reports and new chats.
    - Top brands, live listings by division, average submit-to-approve time, and recent audit activity.
  - `GET /moderator/overview` (moderator, plus admins):
    - Queue sizes, plus my approvals, rejections and closed reports in the range.
    - Open reports by reason and type, and the 5 oldest items in each queue. Verifications are shown to admins only.
  - `GET /seller/overview` (seller, dealer):
    - Listings by status, views, saves, chats and unread messages, and the chat-to-sale rate.
    - Rating and verification status, daily chats, saves and sales.
    - Top 5 listings, listings expiring within 7 days, and the latest reviews.
  - `GET /buyer/overview` (buyer, dealer staff, inspector): saved listings (available and unavailable), recently viewed, active chats, my reports, reviews written, verification status, daily activity, latest saved listings and saved listings by brand.
  - `GET /staff/queue-counts` (staff): pending listings, open reports and pending verifications for the sidebar badges.
  - The admin and moderator overviews are cached in Redis for `DASHBOARD_CACHE_SECONDS` (default 60). The cache never breaks a request.
  - Days are bucketed in `TIMEZONE` (default Asia/Dhaka) with parameterised SQL.
- **auditLog module** (`/audit-logs`, read-only, super admin and admin):
  - List with search, action, entity, entity ID, user and date filters, plus a list of entities for the filter dropdown.
  - One entry by ID.
  - Admins never see entries made by a super admin; a hidden entry returns 404.
  - Keys containing password, secret, token or otp are returned as `[redacted]`.
- **Audit helpers** (`utils/auditLogger.ts`): `getAuditActor(req)` and `buildAuditDiff()`, which keeps only the fields that changed.
- **Config/env**: `TIMEZONE`, `DASHBOARD_CACHE_SECONDS`.
- **Tests**: range parsing and local-day boundaries (UTC+6), empty-day filling, ratios and change, redaction, admin vs super admin visibility, audit date filters, audit diffs.
- **Postman**: Dashboard and Audit Logs folders.

### Changed
- **Audit logging now covers the catalog and report decisions**:
  - Vehicle types, brands and models: create, update (only the changed fields) and delete. Attribute schema changes are logged in the same transaction.
  - Report decisions: in review, resolve and dismiss, with the action taken and the number of reports closed.
- Catalog services take an extra `actor` argument for the audit entry. Behaviour is otherwise unchanged.

## [0.6.0] — Phase 1 · Part 5: chat + notifications (2026-11-21)

### Added
- **Migration `chat_notifications`**:
  - New tables: `Conversation`, `Message`, `QuickReply`, `UserBlock`, `Notification` and `NotificationPreference`.
  - New enums: `MessageType`, `NotificationCategory` and `NotificationType`.
  - `Report.messageId` is now a real relation to `Message`.
- **Socket.io** (`lib/socket.ts`), on the same HTTP server and CORS whitelist as the API:
  - The browser connects with a short-lived socket token from `POST /auth/socket-token`, signed with the new `JWT_SOCKET_SECRET`. REST `auth()` never accepts it, and the httpOnly access token never reaches browser JavaScript.
  - The handshake runs the same user checks as `auth()`. Writes re-check the user and disconnect the socket if they were blocked or signed out.
  - Each user has a `user:<id>` room, and online status comes from the room size.
- **BullMQ** (`lib/queue.ts`), on the existing node-redis client (no ioredis):
  - A `notification-email` queue with 3 retries and exponential backoff.
  - The worker runs in the API process (`jobs/notificationEmail.job.ts`).
- **chat module** (`/conversations`, for buyer, seller, dealer, dealer staff and inspector):
  - One thread per buyer per listing. New threads can only be started on approved listings, never your own, and never when either side has blocked the other.
  - Threads stay open when a listing is sold, expired or back in review. They become read-only when the listing is taken down or deleted, or when the other account is gone.
  - Text messages over the socket (`message:send` with an ack) or REST, both through the same service. A client `clientId` makes retries idempotent.
  - Photo messages: up to 4 per send, images only, all-or-nothing upload, one message per photo.
  - Typing indicators (throttled), read receipts (`conversation:read`), and unread counters per side, updated in the same transaction as the message.
  - Per-side archive. A new message moves the thread back to the inbox.
  - Cursor pagination for messages: `meta: { limit, hasMore, nextCursor }`. `sendResponse` accepts this meta shape.
  - Rate limits in Redis: `CHAT_MESSAGE_RATE_LIMIT` per minute and `CHAT_NEW_CONVERSATION_LIMIT` per hour.
  - When a listing is marked sold, a SYSTEM message is posted in its threads.
- **quickReply module**:
  - Built-in buyer and seller replies, sent by key and resolved on the server.
  - Up to 10 custom replies per user.
- **userBlock module** (`/blocks`): block and unblock (both directions) and a list of blocked users. Both users get a `block:changed` socket event.
- **notification module**:
  - In-app notifications pushed live (`notification:new`, `notification:unread`), plus list, unread count, mark read, mark all read and delete.
  - Preferences per category and channel. ACCOUNT and in-app MESSAGES are always on.
  - One-click email unsubscribe with a signed token (`POST /notifications/unsubscribe`).
  - Domain events trigger notifications:
    - The seller hears when a listing is approved, rejected or expired.
    - Users who saved a listing hear about price drops and sales.
    - Sellers hear about new reviews; reviewers hear about replies.
    - Reporters hear when their report is resolved or dismissed.
    - Users hear about verification decisions.
  - Unread-message email digest: a delayed job per conversation and recipient (`CHAT_EMAIL_DELAY_MINUTES`). It is sent only if the messages are still unread, the user is offline and email is on, at most once an hour.
- **Reports for messages**: participants can report a message (not their own, and not system messages). Staff see it with the 5 messages before it. Resolving with `BLOCK_USER` blocks the sender.
- **Events**: `review.replied`, `report.resolved` (one per closed report) and `message.created`.
- **Email templates**: `notification` and `unread-messages`.
- **Cron**: read notifications are deleted daily at 04:00, after `NOTIFICATION_RETENTION_DAYS` (default 90).
- **Seed**: demo conversations between the demo buyer and the demo seller and dealer, plus sample notifications.
- **Helpers**: `utils/redisRateLimit.ts`, `helper/dashboardPath.ts` (role → dashboard path for links) and `helper/formatPrice.ts`.
- **Config/env**: `JWT_SOCKET_SECRET`, `SOCKET_TOKEN_EXPIRES_IN`, `CHAT_MESSAGE_RATE_LIMIT`, `CHAT_NEW_CONVERSATION_LIMIT`, `CHAT_EMAIL_DELAY_MINUTES`, `NOTIFICATION_RETENTION_DAYS`, `CURRENCY` and `CURRENCY_LOCALE`.
- **Tests**:
  - Chat: start and reply rules, unread counter updates, message normalisation and validation, quick replies.
  - Socket tokens: rejected by REST, and the handshake rejects missing, access-type and untyped tokens.
  - Notifications: preference resolution and locked channels, unsubscribe tokens, digest skip rules.
  - Reports: message report actions.
- **Postman**: Conversations (with the socket event reference), Quick Replies, Blocks and Notifications folders, plus Socket Token and Report Message.

### Changed
- `checkAuth`: the user checks moved into `loadAuthUser()`, which REST and the socket handshake share. Behaviour is unchanged.
- Review eligibility: a conversation about the listing now also counts as an interaction.
- `server.ts` uses `http.createServer(app)` for Socket.io, starts the email worker, and closes the sockets and queues on shutdown.

## [0.5.0] — Phase 1 · Part 4: engagement + trust (2026-11-21)

### Added
- **Migration `engagement_trust`**:
  - New tables: `WishlistItem`, `RecentlyViewed`, `Review`, `Report`, `VerificationRequest` and `VerificationDocument`.
  - New enums for report targets, reasons and statuses, and for verification types, statuses and document kinds.
  - New `User` fields: `ratingAverage`, `ratingCount`, `idVerifiedAt` and `dealerVerifiedAt`.
- **wishlist module**:
  - Save and remove listings (approved only, never your own; saving is idempotent).
  - My wishlist returns cards with `isAvailable`, and a list of saved IDs for heart icons.
- **recentlyViewed module**:
  - A view is recorded when a signed-in user opens a listing they don't own. Only the latest 50 are kept.
  - Users can list, remove one or clear all.
- **review module** (seller ratings):
  - One review per listing. The reviewer needs a verified email or phone and must have viewed or saved the listing.
  - The eligibility endpoint returns reason codes.
  - Authors can edit within 30 days. Authors and admins can delete; admin deletes are audit-logged.
  - Sellers can reply once.
  - Moderators can hide or unhide a review, with a reason.
  - The seller rating counts visible reviews only.
  - The public list returns an average, a count and a 1–5 distribution.
- **report module**:
  - Users can report listings, users and reviews. Message reports arrive with chat.
  - Limits: one open report per target, and 10 reports per hour (Redis).
  - The staff queue is sorted by priority (most-reported targets first) and shows the number of open reports per target.
  - Resolving a report can take down the listing, hide the review or block the user (admins only). It also closes the other open reports on the same target.
- **verification module**:
  - ID verification: NID front, back and selfie. Only the last 4 NID digits are stored.
  - Dealer verification: trade license, an optional TIN certificate and up to 4 showroom photos. PDFs are allowed for the license and TIN only.
  - Files go to Cloudinary as private uploads, and admins view them through signed links that expire after 10 minutes.
  - Admins approve or reject (rejecting needs a reason). Admins can't review their own request.
  - Approving a dealer also activates a PENDING dealer account.
  - Every decision is audit-logged.
- **Verified badges**: `helper/sellerBadges.ts` adds phone, ID and dealer badges and the seller rating to listing cards, listing detail and the new public seller profile (`GET /users/:id/public`).
- **Cron**: verification documents are purged daily at 03:00, 30 days after a decision.
- **Events**: review.created, report.created, and verification.submitted, approved and rejected.
- **Tests**: review eligibility and edit window, report target mapping, action rules and priority sort, verification document rules, NID masking, purge timing, and payload validation.
- **Postman**: Wishlist, Recently Viewed, Reviews, Reports and Verifications folders, plus Public Seller Profile.

### Changed
- `uploadToCloudinary` supports private uploads and returns the public ID, resource type, format and size. New helpers: `deleteFromCloudinary` options and `getPrivateDownloadUrl`.

## [0.4.0] — Phase 1 · Part 3: listing + search (2026-11-20)

### Added
- **Migration `listings_and_search`**:
  - `Listing` with a dynamic `specs` JSON column, location with optional exact coordinates, the status lifecycle fields and `viewsCount`.
  - `ListingImage`, with sort order and a cover flag.
  - New enums `ListingStatus` and `ListingCondition`.
  - GIN indexes on `specs` (`jsonb_path_ops`) and on `search_vector` (tsvector). Both are declared in the Prisma schema, so they never drift.
- **listing module** (owner):
  - Create a draft; specs auto-fill from the model and location from the seller's profile.
  - Autosave updates. Approved listings return to review on major edits; price, negotiable, description, video and color edits stay live.
  - Photos: upload (all-or-nothing, max 15), reorder and set cover, delete (the cover moves to the next photo).
  - Submit, with a checklist of everything missing; mark sold; renew; soft delete.
  - My listings, with counts per status.
- **listing module** (staff and public):
  - Moderation queue (`/manage`), approve, and reject with a reason (approved listings can also be taken down). Every moderation action is audit-logged.
  - Public detail: unapproved listings are visible only to the owner and staff. A view is counted once per viewer per 24 hours, never for the owner.
  - Similar listings, scored by same model, then same brand, then closest price.
- **search module**:
  - One parameterised SQL query built with `Prisma.sql`.
  - Full-text search with prefix matching and relevance ranking; it supports Bangla.
  - Filters: brand and model lists, price, year, mileage, condition, negotiable, division and district.
  - Radius search: a bounding box, then the Haversine distance.
  - Dynamic spec filters (`spec.<key>.min/.max`, `spec.<key>=a,b`) that use the GIN index.
  - 7 sort options.
  - `/search/filters` returns the data for the filter sidebar, with counts.
- **Events** (`events/appEvents.ts`): listing submitted, approved, rejected, sold, price dropped and expired. Handlers only log for now.
- **Cron**: listings expire daily once past `expiresAt` (`LISTING_DURATION_DAYS`, default 60).
- **Become seller**: `POST /users/me/become-seller` (BUYER → SELLER, fresh tokens).
- **Middleware**: `optionalAuth` for public routes that recognise signed-in users.
- **Data**:
  - `helper/bdLocations.ts`: 8 divisions and 64 districts with centre coordinates.
  - Seed: 24 approved sample listings. The seed is now resumable per listing.
- **Tests**: status flow, edit rules, ownership, submit checklist, search SQL building (bound parameters, injection), tsquery building (including Bangla), spec filter parsing, query validation, locations.
- **Postman**: Listings and Search folders, plus Become Seller.

### Changed
- vehicleType schema changes are now also checked against listing specs.
- Deleting a vehicle type, brand or model returns 409 while listings use it.
- `sendResponse` meta allows extra keys, such as `statusCounts`.

### Fixed
- Bangla vowel signs (combining marks) were split out of search words.

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
