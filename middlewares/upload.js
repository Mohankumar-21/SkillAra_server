/**
 * Multipart upload handling.
 *
 * Files are buffered in memory and streamed on to Backblaze B2 by the controller —
 * nothing is written to the app server's disk, so instances stay stateless and
 * course media never becomes a local-filesystem dependency.
 *
 * Large video does NOT go through here. The client asks for a presigned PUT URL
 * (POST /api/courses/:id/lessons/:lessonId/upload-url) and uploads straight to B2.
 */
import multer from "multer";
import { sendError } from "../utils/helper.js";

export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const DOCUMENT_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "application/zip",
];
export const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"];
export const AUDIO_MIMES = ["audio/mpeg", "audio/mp4", "audio/webm"];

export const ALLOWED_MIMES = [
  ...IMAGE_MIMES,
  ...DOCUMENT_MIMES,
  ...VIDEO_MIMES,
  ...AUDIO_MIMES,
];

const mb = (n) => n * 1024 * 1024;

function buildUploader({ allowed, maxMb }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: mb(maxMb), files: 1 },
    fileFilter(_req, file, cb) {
      if (allowed.includes(file.mimetype)) return cb(null, true);
      return cb(new Error("UPLOAD_FILE_TYPE_INVALID"));
    },
  });
}

/** Course thumbnails / profile images. */
export const uploadImage = buildUploader({
  allowed: IMAGE_MIMES,
  maxMb: Number(process.env.MAX_IMAGE_UPLOAD_MB || 5),
});

/** Lesson attachments and PDF lesson content. */
export const uploadDocument = buildUploader({
  allowed: [...DOCUMENT_MIMES, ...IMAGE_MIMES],
  maxMb: Number(process.env.MAX_DOCUMENT_UPLOAD_MB || 25),
});

/**
 * Small media that is acceptable to proxy through the server. Anything above this
 * limit must use the presigned direct-upload flow instead.
 */
export const uploadMedia = buildUploader({
  allowed: ALLOWED_MIMES,
  maxMb: Number(process.env.MAX_PROXY_UPLOAD_MB || 50),
});

/** Backwards-compatible default used by existing routes. */
export const upload = uploadMedia;

export function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return sendError(res, "UPLOAD_FILE_TOO_LARGE", 413);
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return sendError(res, "UPLOAD_FILE_UNEXPECTED", 400);
    }
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400);
  }
  if (err) {
    if (err.message === "UPLOAD_FILE_TYPE_INVALID") {
      return sendError(res, "UPLOAD_FILE_TYPE_INVALID", 415);
    }
    return next(err);
  }
  return next();
}

/**
 * Wraps a multer middleware so its errors are converted to API responses without
 * needing a separate error middleware after every route.
 */
export function withUpload(multerMiddleware) {
  return (req, res, next) =>
    multerMiddleware(req, res, (err) => handleUploadError(err, req, res, next));
}
