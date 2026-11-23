# Changelog

## [0.14.0] — Phase 2 · Part 3a: finance partners and loan leads (2026-11-22)

### Added
- **`financePartner` module** (`/api/v1/finance-partners`): the banks and finance companies that receive leads.
  - **Public:** `GET /active` returns active partners with their rate range, minimum down payment and maximum tenure (never contact details), plus the platform defaults for the EMI calculator.
  - **Admin (ADMIN, SUPER_ADMIN):** `POST /` (logo upload, same as brands) · `GET /` (search, `isActive`, `openLeadsCount`) · `GET /:id` · `PATCH /:id` · `DELETE /:id`. Delete returns 409 while any lead refers to the partner; deactivate it instead.
- **`loanLead` module** (`/api/v1/loan-leads`): a buyer's financing request for one listing.
  - **Buyer** (buyer, seller, dealer, dealer staff, inspector):
    - `POST /` sends a request.
    - `GET /my` lists their own requests, with `?listingId=` and `?status=OPEN`.
    - `GET /:id` returns one request.
    - `PATCH /:id/withdraw` works while the request is NEW or SENT_TO_PARTNER.
  - **Admin** (ADMIN and SUPER_ADMIN only; moderators are excluded because leads hold income and phone data):
    - `GET /` lists requests with search, status, partner, listing and date filters; `meta.statusCounts` gives the counts for the tabs.
    - `PATCH /:id/assign` sends a request to a partner.
    - `PATCH /:id/status` updates the status.
  - **Workflow:** `NEW → SENT_TO_PARTNER → CONTACTED → APPROVED → DISBURSED`, plus `REJECTED`, `WITHDRAWN` and `CLOSED`.
    - Sending only happens through assign. It can be re-sent to another partner before the partner has called.
    - Final statuses never change.
    - REJECTED and CLOSED need a reason, which the buyer sees.
    - Each step has its own timestamp (`sentAt`, `contactedAt`, `approvedAt`, `disbursedAt`, `closedAt`).
    - Writes are status-guarded: if the request changed meanwhile, the caller gets a 409.
  - **Rules (`loanLead.utils.ts`, pure):**
    - The listing must be live, and buyers can't request financing for their own listing.
    - One open request per listing, and at most `LOAN_LEAD_MAX_OPEN` open requests (default 5). Both checks run under an advisory lock per buyer.
    - The down payment must be at least `LOAN_MIN_DOWN_PAYMENT_PERCENT` of the price (default 10) and less than the price.
    - Tenure is 6–60 months and the rate 0–40%.
    - If the buyer picks a partner, that partner's minimum down payment, maximum tenure and rate range apply.
    - Consent is required and stored as `consentAt`.
  - **Terms:** the price is taken from the listing. `loanAmount` and `estimatedEmi` are computed on the server with the reducing-balance formula (`calculateEmi`, the same one the frontend calculator uses).
  - **Privacy:** buyers never see `adminNote` or the partner's contact details.
- **Events (after commit):**
  - `loanLead.submitted` and `loanLead.withdrawn` notify admins.
  - `loanLead.sentToPartner` and `loanLead.statusChanged` notify the buyer.
  - `events/loanLeadHandlers.ts`: when a listing is sold, expires, is taken down or removed, only its **NEW** requests are closed with a reason. Requests already with a partner stay open.
- **Partner email:** the new `loan-lead-partner` job on the `notification-email` queue sends `templates/loan-lead-partner.ejs` to the partner's contact address. The job re-checks the request first, so a withdrawn or re-assigned request is never sent.
- **Notifications:** `LOAN_LEAD_SUBMITTED` (admins) and `LOAN_LEAD_UPDATED` (buyer), in the new `FINANCING` category (in-app and email, both optional).
- **Sidebar badge:** `loanLeads` in `GET /dashboard/staff/queue-counts` counts NEW requests for admins (null for moderators).
- **Audit log:** partner create/update/delete, assign and status changes.
- **Config:** `LOAN_LEAD_MAX_OPEN`, `LOAN_MIN_DOWN_PAYMENT_PERCENT`, `LOAN_DEFAULT_INTEREST_RATE` (in `.env.example`).
- **Migration:** `loan_leads` adds `finance_partners`, `loan_leads`, `LoanLeadStatus`, `EmploymentType`, the two notification types and the `FINANCING` category.
- **Seed:**
  - 3 made-up partners: Swift Wheels Finance, Green Road Credit, and Harbor Motor Loans (inactive).
  - 2 requests for the demo buyer: one NEW, and one CONTACTED with Swift Wheels.
- **Postman:** "Finance Partners" (6 requests) and "Loan Leads" (7 requests) folders, with the `financePartnerId` and `loanLeadId` variables.
- **Tests:** `tests/loanLead.rules.test.ts` covers the EMI formula, terms against platform and partner limits, who can apply, status transitions, and request and partner validation.

## [0.13.0] — Phase 2 · Part 2b: saved searches and alerts (2026-11-22)

### Added
- **`savedSearch` module** (`/api/v1/saved-searches`), for buyers, sellers, dealers, dealer staff and inspectors (the roles with a Saved Searches page):
  - **Endpoints:** `POST /` save the current search · `GET /` my saved searches · `GET /lookup?<search params>` "is this search saved?" · `GET /:id` with its 20 latest matches · `PATCH /:id` rename, frequency, price drops · `PATCH /:id/seen` clear the "new" badge · `DELETE /:id`.
  - **Query:** the search page's own params (`spec.*` included), canonicalised.
    - Paging, sorting and unknown keys are dropped. Lists and keys are sorted, the search term is lowercased, and "near me" coordinates are rounded to about 100 m.
    - The same filters in another order are the same search: `@@unique([userId, queryHash])`, and a second save gets 409.
    - The query is checked with the search page's own rules. An empty search, invalid specs, or filters that no longer exist get a 400.
  - **Name:** generated from the first three readable filter chips when it isn't given, e.g. "Yamaha · R15 V4 · Under BDT 500,000".
  - **List:** every item has `summary` chips, a `searchUrl` to the newest results, `newMatchesCount` (live matches since `lastViewedAt`) and `totalMatchesCount`.
  - **Limit:** at most `SAVED_SEARCH_MAX_PER_USER` saved searches per user (default 20).
- **Alerts through the internal event system:**
  - **Flow:** `listing.approved` and `listing.priceDropped` go to `events/savedSearchHandlers.ts`. They enqueue `match-listing` on the new `saved-search` queue (`jobs/savedSearchAlert.job.ts`), never in the request cycle.
  - **Candidates:** saved searches with alerts on, the same (or no) vehicle type, an active owner who isn't the seller, and no block either way with the seller.
  - **Price drops** also skip owners who wishlisted the listing (they already get `WISHLIST_PRICE_DROP`) and searches with price-drop alerts off.
  - **Matching:** each candidate runs the search page's exact SQL, restricted to that listing.
  - **NEW_LISTING:** recorded once per search, so a listing approved again after an edit never alerts twice.
  - **PRICE_DROP:** updated on every new drop, and a retried job doesn't alert again.
  - **INSTANT** emits `savedSearch.matched`, which becomes an in-app + email notification by preference. It is capped at `SAVED_SEARCH_INSTANT_MAX_PER_DAY` per search per 24h (default 10, Redis counter). Further matches wait for the digest.
  - **DAILY:** the cron at `SAVED_SEARCH_DIGEST_HOUR` (default 09:00, `TIMEZONE`) emits one `savedSearch.digest` per search with matches not announced yet. It checks each listing is still live and links to the dashboard's saved search page.
  - **OFF:** no matching.
- **Notifications:** `SAVED_SEARCH_MATCH` and `SAVED_SEARCH_PRICE_DROP` in the `PRICE_ALERTS` category.
- **Seed:** two saved searches for the demo buyer, and one with alerts off for buyer2. Matches are found with the real matcher SQL.
  - "Yamaha · R15 V4 · Under BDT 500,000" (instant) has two new matches and a price drop.
  - "Bajaj · Pulsar N160 · Dhaka" (daily) has 4 matches waiting for the digest.
- **Postman:** "Saved Searches" folder (7 requests, `savedSearchId` variable).
- **Tests:** `tests/savedSearch.rules.test.ts` covers canonical query and hash, filter chips, the generated name, the results link, the stored-query guard and validation.
- **Env:** `SAVED_SEARCH_MAX_PER_USER`, `SAVED_SEARCH_INSTANT_MAX_PER_DAY`, `SAVED_SEARCH_DIGEST_HOUR`.

### Changed
- Migration `saved_searches` adds:
  - `SavedSearch` and `SavedSearchMatch` models.
  - `SavedSearchAlertFrequency` and `SavedSearchMatchKind` enums.
  - Two notification types.
- `SearchService`:
  - Filter resolution (slugs → ids, spec filters) moved into the exported `resolveSearchFilters()`.
  - New `listingMatchesFilters()`.
  - `buildSearchSql` accepts an optional `listingIds`.
  - `/search/listings` behaves exactly as before.

### Notes
- Matching runs one indexed query per candidate saved search. That is fine for thousands of saved searches; a reverse index would be needed beyond that.

## [0.12.0] — Phase 2 · Part 2a: price insight and compare (2026-11-22)

### Added
- **`priceInsight` module** (`/api/v1/price-insights`): `GET /listings/:idOrSlug` rates a listing's price as `GOOD_DEAL`, `FAIR`, `HIGH` or `INSUFFICIENT_DATA`.
  - **Visibility:** public for live and sold listings. The owner and staff also see unpublished ones, so a seller can check a draft's price.
  - **Comparables:** same vehicle type and model, and the same condition group (new, or used + reconditioned). Live listings count, and so do listings sold within `PRICE_INSIGHT_SOLD_LOOKBACK_DAYS` (default 180).
  - **Tiers:** year ±1 and mileage ±50% (5,000 km floor), then year ±2, then year ±3. The first tier with `PRICE_INSIGHT_MIN_SAMPLE` comparables (default 5) is used.
  - **Outliers:** prices below 0.4× or above 2.5× the raw median are dropped before counting.
  - **Rating:** `PRICE_INSIGHT_DEAL_PERCENT` (default 10) or more below the median is a good deal; that much above is high.
  - **Response:** `median`, `p25`, `p75` (rounded to 100), `diffPercent`, `sampleSize`, and a readable `basis` ("Yamaha R15 V4 · 2022–2023 · used") built from the comparables' real year span.
  - **Without a rating:** `reason` is `NO_MODEL` or `TOO_FEW_COMPARABLES`.
  - **Cache:** Redis key `price-insight:<listingId>:<price>` for `PRICE_INSIGHT_CACHE_SECONDS` (default 6h, 0 turns it off). A price change never serves a stale rating.
- **`compare` module** (`/api/v1/compare`): `GET /?ids=a,b,c,d`, public, 1–4 listings.
  - **Order:** columns come back in the order sent.
  - **Same vehicle type:** all listings must share one vehicle type, otherwise 400.
  - **Stale ids:** live and sold listings only. Ids that are gone come back in `missingIds`, because the compare list lives in the browser.
  - **listings:** card fields plus description, colour and price insight.
  - **specRows:** one per attribute that has a value, in schema order, with formatted values per column and `isDifferent`.
  - **highlights:** lowest price, lowest mileage, newest year and best deal (lowest `diffPercent`). Ties are shared, and a row where everyone is equal has no highlight.
- **Seed:** 14 market listings (used R15 V4 and Pulsar N160, three of them recently sold), so the demo shows every rating. The seller's 2023 R15 is fair, the dealer's 2022 one is a good deal, and the 2023 one at BDT 5,65,000 is high.
- **Postman:** "Price Insights" and "Compare" folders.
- **Tests:** `tests/priceInsight.rules.test.ts` (statistics, outliers, tiers, rating bounds) and `tests/compare.rules.test.ts` (query parsing, order, highlights, spec rows).
- **Env:** `PRICE_INSIGHT_MIN_SAMPLE`, `PRICE_INSIGHT_DEAL_PERCENT`, `PRICE_INSIGHT_SOLD_LOOKBACK_DAYS`, `PRICE_INSIGHT_CACHE_SECONDS`.

### Notes
- Neither module has a Prisma model or a `.validation.ts` for a body. `priceInsight` has no input to validate; `compare` validates its query in `compare.validation.ts`. The same exception as `dashboard`.
- Run tests from an uppercase `E:\` path. In a lowercase `e:\` working directory, vitest 5 loads its runner twice, and every suite fails with "Cannot read properties of undefined (reading 'config')".

## [0.11.0] — Phase 2 · Part 1b: test rides (2026-11-22)

### Added
- **`testRide` module** (`/api/v1/test-rides`):
  - **Sellers and dealers:** `GET`/`PUT /availability/me` (the whole week at once), `POST /blocked-dates` and `DELETE /blocked-dates/:id`.
  - **Public:** `GET /slots?listingId=`.
  - **Buyers (the chat roles):** `POST /` to book, `GET /` and `GET /:id` to read.
  - **Status changes:** `PATCH /:id/confirm | decline | cancel | complete | no-show`.
- **Availability:**
  - Weekly rules use local wall time (`TIMEZONE`): a day, start/end time, slot length of 15–120 minutes, and capacity 1–10.
  - Rules without a listing are the seller's defaults. Rules for a listing replace the defaults for that listing.
  - Blocked dates remove whole days. Overlapping ranges are rejected.
- **Slots:**
  - Free slots run from today up to `TEST_RIDE_BOOKING_DAYS` ahead (default 14), starting at least `TEST_RIDE_MIN_LEAD_HOURS` from now (default 2).
  - Capacity counts every requested or confirmed booking of the seller across all listings.
  - Buyers never see the capacity numbers.
- **Booking safety:** the requested time is checked again inside a transaction under an advisory lock on the seller. Two buyers racing for the last place give one 201 and one 409. One upcoming booking per buyer per listing.
- **Lifecycle:**
  - The seller confirms (with an optional meeting note) or declines with a reason. Either side can cancel with a reason before the start.
  - After the start, the seller marks the ride completed or no-show.
  - A request that isn't confirmed by its start time expires.
  - Upcoming rides are cancelled by the system when the listing is sold, expires, is rejected or is deleted.
- **Chat:**
  - A `TEST_RIDE` card (`Message.testRideId`) is posted on booking, and a SYSTEM notice on each status change. Messages now include the live `testRide` state.
  - Socket event `testRide:updated`.
  - The chat list preview and email digest show "🏍️ Test ride request: …".
- **Jobs:** the `scheduled` queue gains `test-ride-expire` (at the start time) and `test-ride-reminder` (24h and 2h before a confirmed ride; reminders already in the past are skipped). The hourly sweep now also expires unconfirmed requests.
- **Notifications:** new `TEST_RIDES` category (in-app and email, both optional) for requested, confirmed, declined, cancelled, expired and reminder. Reminders go to both sides.
- **Seed:** weekly hours for the demo seller (Sat–Thu 10:00–18:00) and dealer (10:00–20:00, 2 at once), one requested ride (buyer ↔ seller) and one confirmed ride (buyer2 ↔ dealer).
- **Postman:** "Test Rides" folder (13 requests). The slots request saves the first free slot as `slotStartsAt`.
- **Tests:** `tests/testRide.rules.test.ts` covers time zones (including DST), slot generation, capacity, lead time, the booking window, the action rules and validation.

### Changed
- Migration `test_rides`: `TestRideAvailability`, `TestRideBlockedDate` and `TestRide` models, the `TestRideStatus` enum, `Message.testRideId`, `MessageType.TEST_RIDE`, the `TEST_RIDES` notification category and its types.
- Time zone helpers moved from `dashboard.utils.ts` to the shared `helper/timeZone.ts`, adding `localTimeToUtc`, `dayOfWeekOf` and `formatLocalDateTime`. `dashboard.utils.ts` re-exports the two it published, so dashboard behaviour is unchanged.
- `ChatService.postOfferCard` / `postOfferNotice` are now `postCardMessage` / `postCardNotice` and take an `offerId` or a `testRideId`.
- The conversation summary's `listing` now includes `isNegotiable`, so the chat composer knows when to offer "Make an offer".

## [0.10.0] — Phase 2 · Part 1a: offers (2026-11-22)

### Added
- **`offer` module** (`/api/v1/offers`) for buyers, sellers, dealers, dealer staff and inspectors (the chat roles):
  - `POST /` make an offer · `GET /` my offers · `GET /:id` one offer with the conversation's full history
  - `POST /:id/counter` · `PATCH /:id/accept` · `PATCH /:id/decline` · `PATCH /:id/withdraw`
- **Rules:**
  - Offers are allowed on APPROVED, negotiable listings only, never your own.
  - The amount must be between `OFFER_MIN_PERCENT` (default 50%) of the price and the asking price.
  - One open offer per conversation, and no new offer after one was accepted.
  - Counters must move towards the other side. At most `OFFER_MAX_ROUNDS` (default 5) rounds.
  - Offers expire after `OFFER_EXPIRY_HOURS` (default 48).
  - Accepting does not reserve the listing. Other buyers keep their open offers and get a notification.
- **Race safety:** every change runs in a transaction under an advisory lock on the conversation, and the status update only applies while the offer is still PENDING. Two parallel accepts give one 200 and one 409.
- **Chat:**
  - Each offer or counter is an `OFFER` card message (`Message.offerId`). Messages now include the live `offer` state.
  - Accept, decline, withdraw, expiry and cancellation post a SYSTEM notice with the offer linked.
  - The socket event `offer:updated` updates cards live.
  - The conversation preview and email digest show "💰 Offer: BDT …".
- **Expiry:** a delayed `offer-expire` job runs on the new `scheduled` queue (`jobs/scheduled.job.ts`). An hourly cron sweep (`expireOffers`) catches lost jobs.
- **Cancellation:** open offers close automatically when their listing is sold, expires, is rejected or is deleted. `deleteListing` now emits a new `listing.deleted` event.
- **Notifications:** new `OFFERS` category (in-app and email, both optional) with 8 types: received, countered, accepted, declined, withdrawn, expired, cancelled, and "another offer accepted".
- **Seed:** three demo negotiations: an open offer (buyer ↔ seller), a countered one waiting for buyer2, and an accepted one.
- **Postman:** "Offers" folder with 7 requests and an `offerId` variable.
- **Tests:** `tests/offer.rules.test.ts` covers the make/action/counter rules, helpers and validation.

### Changed
- Migration `offers`: `Offer` model, `OfferStatus` enum, `Message.offerId`, `MessageType.OFFER`, the `OFFERS` notification category and the new notification types.
- `ChatService` adds `findOrCreateConversation`, `assertCanReplyInConversation`, `postOfferCard` and `postOfferNotice`. Existing endpoints behave as before; message payloads gain `offerId` and `offer`.

## [0.9.1] — Fix notification-email worker TimeoutError loop (2026-11-21)

### Fixed
- **Worker `TimeoutError` flood:** BullMQ workers now get a Redis connection with the node-redis command timeout turned off (`lib/queue.ts`, `createWorkerConnection`).
  - **Cause:** node-redis cancels commands after 5s by default, and a worker keeps its connection busy with long blocking waits for jobs. An idle `notification-email` worker therefore logged about 16 `TimeoutError`s per second and retried in a tight loop, which could make the dev server stop responding.
  - **Result:** in a 70s idle test, errors went from 1,123 to 0, and a job is still picked up within a second.
  - **Unchanged:** the queue connection and the app Redis client keep the 5s timeout.

## [0.9.0] — Phase 1 review: conventions, demo seed, docs (2026-11-21)

### Changed
- **Timestamps (CONVENTIONS §A8):** `updatedAt` added to ListingImage, Message, Notification, RefreshToken, UserBlock, VerificationDocument, WishlistItem and BrandVehicleType; RecentlyViewed gets `createdAt` + `updatedAt` (it keeps `viewedAt`). Migration `timestamps_updated_at` backfills existing rows from `createdAt` / `viewedAt`.
- **Formatting:** Biome `format --write` over `src/` and `tests/` (91 files, layout only). `format:check` now passes.
- **Lint:** Node built-ins use the `node:` prefix; unused handler parameters are `_req` / `_res`. The remaining 6 warnings are `process.env.X!` in `config`, kept to match the reference.

### Added
- **`npm run seed`** now also creates (all steps idempotent):
  - Extra accounts: `buyer2@ridex.demo`, `dealer2@ridex.demo` (unverified dealer), `blocked@ridex.demo` (BLOCKED) and `deleted@ridex.demo` (soft-deleted).
  - Listings in every status: 3 pending, 1 rejected with a reason, 1 draft, 2 sold, 2 approved listings that expire within 7 days.
  - Trust: the seller is phone + ID verified and the dealer is phone + dealer verified, each with an approved request and an audit entry.
  - Pending ID (buyer2) and dealer (dealer2) verification requests. Their documents are generated placeholder PNGs uploaded privately to Cloudinary (skipped when Cloudinary is not configured).
  - Moderation history: audit APPROVE / REJECT entries by the demo moderator for the seeded decisions.
  - Saved bikes (one already sold), recently viewed, a block (buyer2 → blocked) and 3 seller quick replies.
  - Reviews: 5★ with a seller reply, 4★ for the dealer, and a 1★ review hidden by the moderator.
  - Reports: open (listing, message), in review (user), resolved (review hidden) and dismissed (listing).
  - A table of every demo login at the end (passwords are never printed).
- **Postman:** a "Demo Logins" folder (one request per seeded role). Login-type requests save `accessToken` / `refreshToken`, and create requests save the new id (`listingId`, `brandId`, …). New `RideX.postman_environment.json` ("RideX Local") with empty password placeholders.

## [0.8.0] — Phase 1 · Part 7: public homepage data (2026-11-21)

### Added
- **`GET /search/home`** (public): everything the homepage needs in one call.
  - `featured`: up to 12 approved listings. Until paid boosts arrive (Phase 2) they are ranked by saves ×3 + chats ×2 (both over the last 30 days) + views ÷ 50, with bonuses for having photos, a verified seller (ID or dealer) and freshness (fades out over 14 days). The most viewed and the newest 40 listings are ranked together, so a new listing can be featured before it has views.
  - `categories`: every option of the bike `bikeCategory` attribute, in schema order, with its live listing count.
  - `brands`: the top 12 active brands (popular first, then by live listings) with counts.
  - `vehicleTypes`: active types with live listing counts.
  - `stats`: live listings, verified sellers, districts with live listings, and bikes sold in the last 30 days.
- Cached in Redis under `search:home` for `HOME_CACHE_SECONDS` (default 300, 0 turns it off). A Redis failure falls back to the database.
- **Config/env**: `HOME_CACHE_SECONDS`.
- **Tests**: featured scoring and ranking (weights, bonuses, ties, limit) and category count mapping.
- **Postman**: Search → Homepage Data.

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
