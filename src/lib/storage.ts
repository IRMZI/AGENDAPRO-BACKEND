import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * S3-compatible object storage (Railway bucket / MinIO / R2 / AWS S3).
 * All config comes from env so the same code targets any provider:
 *   S3_ENDPOINT           e.g. https://bucket.up.railway.app  (omit for AWS)
 *   S3_REGION             e.g. us-east-1
 *   S3_BUCKET             bucket name
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_PUBLIC_URL         public base for object URLs (optional; derived if unset)
 *   S3_FORCE_PATH_STYLE   "true" for MinIO / path-style endpoints
 *
 * NOTE: env is read lazily (not at module load). dotenv.config() runs in app.ts
 * AFTER this module is imported by the route tree, so top-level reads would see
 * undefined. Reading inside functions guarantees the values are populated.
 */
const cfg = () => ({
  endpoint: process.env.S3_ENDPOINT || undefined,
  region: process.env.S3_REGION || "us-east-1",
  bucket: process.env.S3_BUCKET || "",
  accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  publicBase: process.env.S3_PUBLIC_URL || "",
});

/** True only when all credentials needed to upload are present. */
export const isStorageConfigured = (): boolean => {
  const c = cfg();
  return Boolean(c.bucket && c.accessKeyId && c.secretAccessKey);
};

let client: S3Client | null = null;
const getClient = (): S3Client => {
  if (!client) {
    const c = cfg();
    client = new S3Client({
      region: c.region,
      endpoint: c.endpoint,
      forcePathStyle: c.forcePathStyle,
      credentials: {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
      },
    });
  }
  return client;
};

/** Build the public URL for a stored object key. */
export const publicUrlForKey = (key: string): string => {
  const c = cfg();
  if (c.publicBase) return `${c.publicBase.replace(/\/+$/, "")}/${key}`;
  if (c.endpoint) {
    const base = c.endpoint.replace(/\/+$/, "");
    // Path-style keeps things simple for MinIO/Railway; virtual-host needs the
    // bucket in the hostname which most self-hosted setups don't have.
    return c.forcePathStyle ? `${base}/${c.bucket}/${key}` : `${base}/${key}`;
  }
  return `https://${c.bucket}.s3.${c.region}.amazonaws.com/${key}`;
};

/** Upload a buffer and return its public URL. */
export const uploadBuffer = async (
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> => {
  await getClient().send(
    new PutObjectCommand({
      Bucket: cfg().bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return publicUrlForKey(key);
};

/** Best-effort delete of an object by its key (used when replacing images). */
export const deleteByKey = async (key: string): Promise<void> => {
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: cfg().bucket, Key: key }),
    );
  } catch {
    // Non-fatal: a stale object left in the bucket is harmless.
  }
};
