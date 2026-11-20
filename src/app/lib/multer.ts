import multer from "multer";
import httpStatus from "http-status";
import { config } from "../config";
import { AppError } from "../utils/AppError";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "application/pdf",
];

const storage = multer.memoryStorage();

export const upload = multer({
  storage: storage,
  limits: {
    fileSize: config.max_upload_size_mb * 1024 * 1024,
    files: 20,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(
        new AppError(
          httpStatus.UNSUPPORTED_MEDIA_TYPE,
          `File type ${file.mimetype} is not allowed`,
        ),
      );
      return;
    }

    cb(null, true);
  },
});
