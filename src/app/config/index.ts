import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export const config = {
  // ============================================
  // App
  // ============================================

  app_name: process.env.APP_NAME || "RideX",
  frontend_url: process.env.FRONTEND_URL || "http://localhost:3000",
  backend_url: process.env.BACKEND_URL || "http://localhost:5000",
  cors_origins: (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  port: process.env.PORT || "5000",
  node_env: process.env.NODE_ENV || "development",

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

  // ============================================
  // Rate Limit
  // ============================================

  rate_limit_window_minutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 15),
  rate_limit_max: Number(process.env.RATE_LIMIT_MAX || 300),

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
