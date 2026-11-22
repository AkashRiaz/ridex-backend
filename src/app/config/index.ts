import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export const config = {
  // ============================================
  // App
  // ============================================

  app_name: process.env.APP_NAME || "RideX",
  frontend_url: process.env.FRONTEND_URL || "http://localhost:3000",
  backend_url: process.env.BACKEND_URL || "http://localhost:5000",
  cors_origins: (
    process.env.CORS_ORIGINS ||
    process.env.FRONTEND_URL ||
    "http://localhost:3000"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  port: process.env.PORT || "5000",
  node_env: process.env.NODE_ENV || "development",
  // used in notification and email texts; match NEXT_PUBLIC_CURRENCY / NEXT_PUBLIC_DEFAULT_LOCALE
  currency: process.env.CURRENCY || "BDT",
  currency_locale: process.env.CURRENCY_LOCALE || "en-BD",
  // IANA zone used to bucket dashboard charts by local day
  timezone: process.env.TIMEZONE || "Asia/Dhaka",
  dashboard_cache_seconds: Number(process.env.DASHBOARD_CACHE_SECONDS || 60),
  home_cache_seconds: Number(process.env.HOME_CACHE_SECONDS || 300),

  // ============================================
  // Auth
  // ============================================

  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS || "12",
  jwt_access_secret: process.env.JWT_ACCESS_SECRET!,
  jwt_refresh_secret: process.env.JWT_REFRESH_SECRET!,
  jwt_access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN || "1d",
  jwt_refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  google_client_id: process.env.GOOGLE_CLIENT_ID,
  enable_google_login: process.env.ENABLE_GOOGLE_LOGIN === "true",
  // "lax" for same-site deployments, "none" when frontend and API are on different sites (requires HTTPS)
  cookie_same_site: (process.env.COOKIE_SAME_SITE || "lax") as
    | "lax"
    | "strict"
    | "none",
  cookie_domain: process.env.COOKIE_DOMAIN || undefined,
  // short-lived token the browser uses for the Socket.io handshake (never accepted by REST auth)
  jwt_socket_secret: process.env.JWT_SOCKET_SECRET!,
  socket_token_expires_in: process.env.SOCKET_TOKEN_EXPIRES_IN || "5m",

  // ============================================
  // OTP
  // ============================================

  otp_expires_minutes: Number(process.env.OTP_EXPIRES_MINUTES || 5),
  otp_max_attempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
  otp_resend_cooldown_seconds: Number(
    process.env.OTP_RESEND_COOLDOWN_SECONDS || 60,
  ),
  unverified_user_ttl_hours: Number(
    process.env.UNVERIFIED_USER_TTL_HOURS || 24,
  ),

  // ============================================
  // SMS
  // ============================================

  // "console" prints OTPs in the server log (development). Real gateways are added in lib/sms.ts
  sms_provider: process.env.SMS_PROVIDER || "console",
  sms_api_key: process.env.SMS_API_KEY,
  sms_sender_id: process.env.SMS_SENDER_ID,

  // ============================================
  // Rate Limit
  // ============================================

  rate_limit_window_minutes: Number(
    process.env.RATE_LIMIT_WINDOW_MINUTES || 15,
  ),
  rate_limit_max: Number(process.env.RATE_LIMIT_MAX || 300),
  // shared by login, register, OTP and password-reset endpoints (per IP / 15 min)
  auth_rate_limit_max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),

  // ============================================
  // Redis
  // ============================================

  redis_host: process.env.REDIS_HOST || "localhost",
  redis_port: process.env.REDIS_PORT || "6379",
  redis_password: process.env.REDIS_PASSWORD || undefined,
  redis_user: process.env.REDIS_USER || undefined,

  // ============================================
  // SMTP
  // ============================================

  smtp_user: process.env.SMTP_USER,
  smtp_password: process.env.SMTP_PASSWORD,

  // ============================================
  // Cloudinary / Uploads
  // ============================================

  cloudinary_cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  cloudinary_api_key: process.env.CLOUDINARY_API_KEY!,
  cloudinary_api_secret: process.env.CLOUDINARY_API_SECRET!,
  max_upload_size_mb: Number(process.env.MAX_UPLOAD_SIZE_MB || 5),

  // ============================================
  // Listings
  // ============================================

  listing_duration_days: Number(process.env.LISTING_DURATION_DAYS || 60),
  max_listing_images: Number(process.env.MAX_LISTING_IMAGES || 15),

  // ============================================
  // Chat
  // ============================================

  // messages per user per minute (socket + REST combined)
  chat_message_rate_limit: Number(process.env.CHAT_MESSAGE_RATE_LIMIT || 30),
  // new conversations per user per hour
  chat_new_conversation_limit: Number(
    process.env.CHAT_NEW_CONVERSATION_LIMIT || 20,
  ),
  // unread messages are emailed after this delay if still unread and the user is offline
  chat_email_delay_minutes: Number(process.env.CHAT_EMAIL_DELAY_MINUTES || 10),

  // ============================================
  // Offers
  // ============================================

  // an unanswered offer or counter expires after this many hours
  offer_expiry_hours: Number(process.env.OFFER_EXPIRY_HOURS || 48),
  // lowest offer allowed, as a percent of the asking price
  offer_min_percent: Number(process.env.OFFER_MIN_PERCENT || 50),
  // offers + counters in one negotiation chain
  offer_max_rounds: Number(process.env.OFFER_MAX_ROUNDS || 5),

  // ============================================
  // Test Rides
  // ============================================

  // a slot must start at least this many hours from now
  test_ride_min_lead_hours: Number(process.env.TEST_RIDE_MIN_LEAD_HOURS || 2),
  // how many days ahead buyers can book
  test_ride_booking_days: Number(process.env.TEST_RIDE_BOOKING_DAYS || 14),

  // ============================================
  // Price Insight
  // ============================================

  // fewest comparable listings needed for a rating
  price_insight_min_sample: Number(process.env.PRICE_INSIGHT_MIN_SAMPLE || 5),
  // this percent below the median = good deal, above = high
  price_insight_deal_percent: Number(
    process.env.PRICE_INSIGHT_DEAL_PERCENT || 10,
  ),
  // sold listings count as comparables for this many days after the sale
  price_insight_sold_lookback_days: Number(
    process.env.PRICE_INSIGHT_SOLD_LOOKBACK_DAYS || 180,
  ),
  // 0 turns the cache off
  price_insight_cache_seconds: Number(
    process.env.PRICE_INSIGHT_CACHE_SECONDS || 21600,
  ),

  // ============================================
  // Saved Searches
  // ============================================

  saved_search_max_per_user: Number(
    process.env.SAVED_SEARCH_MAX_PER_USER || 20,
  ),
  // instant alerts per saved search per 24h; later matches wait for the digest
  saved_search_instant_max_per_day: Number(
    process.env.SAVED_SEARCH_INSTANT_MAX_PER_DAY || 10,
  ),
  // local hour (TIMEZONE) the daily digest is sent, 0-23
  saved_search_digest_hour: Number(process.env.SAVED_SEARCH_DIGEST_HOUR || 9),

  // ============================================
  // Notifications
  // ============================================

  // read notifications older than this are deleted by the daily cron
  notification_retention_days: Number(
    process.env.NOTIFICATION_RETENTION_DAYS || 90,
  ),

  // ============================================
  // Super Admin (seeded on boot)
  // ============================================

  super_admin_name: process.env.SUPER_ADMIN_NAME,
  super_admin_email: process.env.SUPER_ADMIN_EMAIL,
  super_admin_password: process.env.SUPER_ADMIN_PASSWORD,

  // ============================================
  // Demo Users (npm run seed)
  // ============================================

  demo_user_password: process.env.DEMO_USER_PASSWORD,
};
