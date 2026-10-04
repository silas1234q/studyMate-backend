import multer from "multer";
import type { Request, Response, NextFunction } from "express";

/**
 * Cloudinary is the binding constraint, not us: it rejects anything past 10MB, so a
 * higher limit here just means the user waits out a full upload before it fails.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Formats we can actually read text out of. Anything else is rejected up front. */
const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/msword",
  "application/rtf",
]);

const isAccepted = (mimeType: string) =>
  mimeType.startsWith("image/") || mimeType.startsWith("text/") || ACCEPTED_MIME_TYPES.has(mimeType);

/**
 * Files are streamed straight to Cloudinary, so they never touch disk.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isAccepted(file.mimetype)) return cb(null, true);
    cb(new Error("UNSUPPORTED_FILE_TYPE"));
  },
});

/**
 * Multer throws outside the normal AppError hierarchy, so translate its two
 * user-facing failures into readable 400s instead of a generic 500.
 */
export function handleUploadErrors(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({
      success: false,
      type: "VALIDATION_ERROR",
      message: `File is too large. The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`,
    });
    return;
  }
  if (err instanceof Error && err.message === "UNSUPPORTED_FILE_TYPE") {
    res.status(400).json({
      success: false,
      type: "VALIDATION_ERROR",
      message: "Unsupported file type. Upload an image, PDF, Word, PowerPoint, Excel or text file.",
    });
    return;
  }
  next(err);
}
