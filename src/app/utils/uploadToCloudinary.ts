import { cloudinary } from "../lib/cloudinary";

export const uploadToCloudinary = (
  file: Express.Multer.File,
  options: { folder?: string } = {},
) => {
  return new Promise<{
    secure_url: string;
    public_id: string;
  }>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "auto",
        ...(options.folder && { folder: options.folder }),
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
        });
      },
    );

    uploadStream.end(file.buffer);
  });
};

/*
 * Best-effort delete (e.g. replaced avatar). Never throws.
 */
export const deleteFromCloudinary = async (publicId?: string | null) => {
  if (!publicId) return;

  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Cloudinary delete failed:", error);
  }
};
