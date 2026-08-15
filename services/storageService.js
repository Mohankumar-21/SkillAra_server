/**
 * Object storage backed by Backblaze B2 (S3-compatible API).
 *
 * Course media is never served from the app server. Uploads land in a private
 * bucket under a tenant-scoped key prefix, and playback happens through
 * short-lived presigned URLs so object keys are not guessable or shareable
 * beyond their TTL.
 *
 * Key layout:
 *   tenants/{tenantId}/courses/{courseId}/thumbnail/{uuid}.{ext}
 *   tenants/{tenantId}/courses/{courseId}/lessons/{lessonId}/{uuid}.{ext}
 *   tenants/{tenantId}/courses/{courseId}/attachments/{uuid}.{ext}
 */
import crypto from "crypto";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import logger from "../core/logger.js";
import { AppError } from "../utils/appError.js";

/** Seconds a playback/download URL stays valid. Short by design. */
export const DOWNLOAD_URL_TTL_SECONDS = Number(process.env.B2_DOWNLOAD_URL_TTL || 900); // 15 min
/** Seconds a browser has to complete a direct-to-B2 upload. */
export const UPLOAD_URL_TTL_SECONDS = Number(process.env.B2_UPLOAD_URL_TTL || 3600); // 1 hour

let cachedClient = null;

function readConfig() {
  return {
    endpoint: process.env.B2_ENDPOINT || "",
    region: process.env.B2_REGION || "",
    bucket: process.env.B2_BUCKET || "",
    keyId: process.env.B2_KEY_ID || "",
    appKey: process.env.B2_APP_KEY || "",
  };
}

/**
 * Backblaze endpoints encode the region: s3.us-east-005.backblazeb2.com → us-east-005.
 * Falls back to B2_REGION when the endpoint is non-standard.
 */
function deriveRegion({ endpoint, region }) {
  if (region) return region;
  const match = /^(?:https?:\/\/)?s3\.([a-z0-9-]+)\.backblazeb2\.com/i.exec(endpoint);
  return match ? match[1] : "us-east-005";
}

/** Names of the required B2 env vars that are unset or blank. */
export function missingStorageConfig() {
  const config = readConfig();
  return Object.entries({
    B2_ENDPOINT: config.endpoint,
    B2_BUCKET: config.bucket,
    B2_KEY_ID: config.keyId,
    B2_APP_KEY: config.appKey,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

/** True when B2 credentials are configured. Routes use this to fail loudly but cleanly. */
export function isStorageConfigured() {
  return missingStorageConfig().length === 0;
}

export function getBucketName() {
  return readConfig().bucket;
}

function getClient() {
  if (cachedClient) return cachedClient;

  const config = readConfig();
  if (!isStorageConfigured()) {
    throw Object.assign(new Error("Backblaze B2 storage is not configured"), {
      status: 503,
      errorKey: "STORAGE_NOT_CONFIGURED",
    });
  }

  const endpoint = config.endpoint.startsWith("http")
    ? config.endpoint
    : `https://${config.endpoint}`;

  cachedClient = new S3Client({
    endpoint,
    region: deriveRegion(config),
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.appKey,
    },
    // B2 requires path-style addressing on its S3 endpoints.
    forcePathStyle: true,
    /**
     * AWS SDK v3.729+ defaults these to "WHEN_SUPPORTED", which wraps the body in
     * `aws-chunked` transfer encoding with a trailing CRC32 checksum. Backblaze B2
     * does not implement that framing: it reads the declared Content-Length against
     * the raw bytes and rejects every upload with `IncompleteBody — The request body
     * was too small`. Forcing WHEN_REQUIRED sends a plain body, which B2 accepts.
     * The request is still signed and travels over TLS.
     */
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return cachedClient;
}

/** Drop the cached client so a config change (or a test) takes effect. */
export function resetStorageClient() {
  cachedClient = null;
}

/**
 * B2 rejects bad credentials with these S3 error codes. Notably, the account
 * **Master Application Key is not accepted by the S3-compatible API** and surfaces as
 * InvalidAccessKeyId ("Malformed Access Key Id") — create a bucket-scoped application
 * key instead. Run `node scripts/checkStorage.js` to diagnose.
 */
const CREDENTIAL_ERROR_CODES = new Set([
  "InvalidAccessKeyId",
  "SignatureDoesNotMatch",
  "AccessDenied",
  "AccountProblem",
  "NoSuchBucket",
]);

/**
 * Convert an SDK failure into an operational AppError so the client sees a clear 503
 * instead of a generic 500. Always throws.
 */
function throwStorageError(err, operation) {
  logger.error(`[storage] ${operation} failed: ${err?.name} — ${err?.message}`);

  // Distinct from STORAGE_NOT_CONFIGURED (missing env vars): here the request did
  // reach B2 and the key itself was refused. Keeping these apart makes the logs say
  // which of the two it is without extra digging.
  if (CREDENTIAL_ERROR_CODES.has(err?.name)) {
    throw new AppError("STORAGE_CREDENTIALS_REJECTED", 503, { reason: err.name });
  }
  throw new AppError("STORAGE_UNAVAILABLE", 503, { reason: err?.name || "unknown" });
}

const SAFE_EXT = /^[a-z0-9]{1,8}$/i;

function safeExtension(filename, mimeType) {
  const ext = path.extname(String(filename || "")).replace(".", "").toLowerCase();
  if (SAFE_EXT.test(ext)) return ext;

  const fromMime = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  }[String(mimeType || "").toLowerCase()];

  return fromMime || "bin";
}

/**
 * Build a tenant-scoped object key. Every caller must pass tenantId — this is the
 * single place that enforces the tenants/{tenantId}/... prefix, which in turn makes
 * bucket-level tenant isolation auditable.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.courseId
 * @param {"thumbnail"|"lessons"|"attachments"} args.scope
 * @param {string} [args.lessonId] required when scope is "lessons"
 * @param {string} args.filename original filename (used only for its extension)
 * @param {string} [args.mimeType]
 */
export function buildCourseKey({ tenantId, courseId, scope, lessonId, filename, mimeType }) {
  if (!tenantId) throw new Error("buildCourseKey requires tenantId");
  if (!courseId) throw new Error("buildCourseKey requires courseId");

  const ext = safeExtension(filename, mimeType);
  const unique = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const base = `tenants/${tenantId}/courses/${courseId}`;

  if (scope === "lessons") {
    if (!lessonId) throw new Error("buildCourseKey requires lessonId for lesson scope");
    return `${base}/lessons/${lessonId}/${unique}`;
  }
  if (scope === "thumbnail") return `${base}/thumbnail/${unique}`;
  return `${base}/attachments/${unique}`;
}

/**
 * Defence in depth: before signing a URL or deleting, confirm the key really does
 * belong to the caller's tenant. Stops a tampered key in a request body from
 * reaching another tenant's objects.
 */
export function keyBelongsToTenant(key, tenantId) {
  if (!key || !tenantId) return false;
  return String(key).startsWith(`tenants/${tenantId}/`);
}

/**
 * Upload a buffer (from multer memory storage) to B2.
 * @returns {Promise<{key: string, size: number, mimeType: string}>}
 */
export async function putObject({ key, body, mimeType, cacheControl }) {
  const client = getClient();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: getBucketName(),
        Key: key,
        Body: body,
        ContentType: mimeType || "application/octet-stream",
        CacheControl: cacheControl || "private, max-age=0, no-store",
      })
    );
  } catch (err) {
    throwStorageError(err, `putObject ${key}`);
  }

  return {
    key,
    size: body?.length ?? 0,
    mimeType: mimeType || "application/octet-stream",
  };
}

/**
 * Presigned GET URL for playback/download. Callers must have already checked that
 * the requester is allowed to see this object.
 */
export async function getSignedDownloadUrl(key, { ttlSeconds, downloadFilename } = {}) {
  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ...(downloadFilename
      ? {
          ResponseContentDisposition: `attachment; filename="${downloadFilename.replace(/"/g, "")}"`,
        }
      : {}),
  });

  try {
    return await getSignedUrl(client, command, {
      expiresIn: ttlSeconds || DOWNLOAD_URL_TTL_SECONDS,
    });
  } catch (err) {
    return throwStorageError(err, `signDownload ${key}`);
  }
}

/**
 * Presigned PUT URL so the browser uploads large video straight to B2 without
 * passing multi-hundred-megabyte bodies through this server.
 */
export async function getSignedUploadUrl({ key, mimeType, ttlSeconds }) {
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: mimeType || "application/octet-stream",
  });

  let url;
  try {
    url = await getSignedUrl(client, command, {
      expiresIn: ttlSeconds || UPLOAD_URL_TTL_SECONDS,
    });
  } catch (err) {
    return throwStorageError(err, `signUpload ${key}`);
  }

  return { url, key, method: "PUT", headers: { "Content-Type": mimeType } };
}

/** Confirm an object exists (used after a direct browser upload). */
export async function headObject(key) {
  const client = getClient();
  try {
    const res = await client.send(
      new HeadObjectCommand({ Bucket: getBucketName(), Key: key })
    );
    return { exists: true, size: res.ContentLength ?? 0, mimeType: res.ContentType || "" };
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
      return { exists: false, size: 0, mimeType: "" };
    }
    return throwStorageError(err, `headObject ${key}`);
  }
}

/** Best-effort delete — storage cleanup must never fail the user's request. */
export async function deleteObject(key) {
  if (!key) return false;
  try {
    const client = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: key }));
    return true;
  } catch (err) {
    logger.warn(`[storage] failed to delete object ${key}: ${err.message}`);
    return false;
  }
}

/** Best-effort bulk delete, chunked to B2's 1000-key limit. */
export async function deleteObjects(keys = []) {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return 0;

  let deleted = 0;
  try {
    const client = getClient();
    for (let i = 0; i < unique.length; i += 1000) {
      const chunk = unique.slice(i, i + 1000);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: getBucketName(),
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        })
      );
      deleted += chunk.length;
    }
  } catch (err) {
    logger.warn(`[storage] bulk delete failed: ${err.message}`);
  }
  return deleted;
}
