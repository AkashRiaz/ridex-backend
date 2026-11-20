import { cloudinary } from "../lib/cloudinary";

type TUploadOptions = {
  folder?: string;
  // "private": not publicly reachable; read only through signed, expiring links
  type?: "upload" | "private";
};

export type TUploadResult = {
  secure_url: string;
  public_id: string;
  resource_type: string;
  format: string;
  bytes: number;
};

export const uploadToCloudinary = (
  file: Express.Multer.File,
  options: TUploadOptions = {},
) => {
  return new Promise<TUploadResult>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "auto",
        ...(options.folder && { folder: options.folder }),
        ...(options.type && { type: options.type }),
      },

      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        if (!result) {
          reject(new Error("Cloudinary upload failed"));

          return;
        }

        resolve({
          secure_url: result.secure_url,

          public_id: result.public_id,

          resource_type: result.resource_type,

          format: result.format ?? file.originalname.split(".").pop() ?? "",

          bytes: result.bytes,
        });
      },
    );

    uploadStream.end(file.buffer);
  });
};

/*
 * Best-effort delete (e.g. replaced avatar). Never throws.
 */
export const deleteFromCloudinary = async (
  publicId?: string | null,
  options: { type?: "upload" | "private"; resourceType?: string } = {},
) => {
  if (!publicId) return;

  try {
    await cloudinary.uploader.destroy(publicId, {
      ...(options.type && { type: options.type }),
      ...(options.resourceType && { resource_type: options.resourceType }),
      invalidate: true,
    });
  } catch (error) {
    console.error("Cloudinary delete failed:", error);
  }
};

/*
 * Short-lived download link for a private asset (verification documents).
 */
export const getPrivateDownloadUrl = (
  publicId: string,
  format: string,
  resourceType: string,
  expiresInSeconds = 10 * 60,
) =>
  cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    type: "private",
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
