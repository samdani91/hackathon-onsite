import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.ts";
import {
  s3OperationDurationSeconds,
  s3OperationsTotal,
} from "../metrics/prometheus.ts";

// S3 Client
export const s3Client = new S3Client({
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
  ...(env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY && {
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

// Input sanitization for S3 keys - prevent path traversal
export const sanitizeS3Key = (fileId: number): string => {
  // Ensure fileId is a valid integer within bounds (already validated by Zod)
  const sanitizedId = Math.floor(Math.abs(fileId));
  // Construct safe S3 key without user-controlled path components
  return `downloads/${String(sanitizedId)}.zip`;
};

// S3 health check
export const checkS3Health = async (): Promise<boolean> => {
  if (!env.S3_BUCKET_NAME) return true; // Mock mode
  const startTime = Date.now();
  try {
    // Use a lightweight HEAD request on a known path
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: "__health_check_marker__",
    });
    await s3Client.send(command);
    const duration = (Date.now() - startTime) / 1000;
    s3OperationDurationSeconds.labels("HeadObject").observe(duration);
    s3OperationsTotal.labels("HeadObject", "success").inc();
    return true;
  } catch (err) {
    const duration = (Date.now() - startTime) / 1000;
    s3OperationDurationSeconds.labels("HeadObject").observe(duration);
    // NotFound is fine - bucket is accessible
    if (err instanceof Error && err.name === "NotFound") {
      s3OperationsTotal.labels("HeadObject", "not_found").inc();
      return true;
    }
    // AccessDenied or other errors indicate connection issues
    s3OperationsTotal.labels("HeadObject", "error").inc();
    return false;
  }
};

// S3 availability check
export const checkS3Availability = async (
  fileId: number,
): Promise<{
  available: boolean;
  s3Key: string | null;
  size: number | null;
}> => {
  const s3Key = sanitizeS3Key(fileId);

  // If no bucket configured, use mock mode
  if (!env.S3_BUCKET_NAME) {
    const available = fileId % 7 === 0;
    return {
      available,
      s3Key: available ? s3Key : null,
      size: available ? Math.floor(Math.random() * 10000000) + 1000 : null,
    };
  }

  const startTime = Date.now();
  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: s3Key,
    });
    const response = await s3Client.send(command);
    const duration = (Date.now() - startTime) / 1000;
    s3OperationDurationSeconds.labels("HeadObject").observe(duration);
    s3OperationsTotal.labels("HeadObject", "success").inc();
    return {
      available: true,
      s3Key,
      size: response.ContentLength ?? null,
    };
  } catch {
    const duration = (Date.now() - startTime) / 1000;
    s3OperationDurationSeconds.labels("HeadObject").observe(duration);
    s3OperationsTotal.labels("HeadObject", "not_found").inc();
    return {
      available: false,
      s3Key: null,
      size: null,
    };
  }
};
