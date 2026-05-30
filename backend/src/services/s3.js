import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET_NAME;

// ── Upload a file buffer to S3 ────────────────────────────────
export const uploadReceiptToS3 = async (
  fileBuffer,
  originalFilename,
  mimeType,
) => {
  const ext = originalFilename.split(".").pop();
  const key = `receipts/${randomUUID()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    }),
  );

  return key;
};

// ── Generate a signed URL to view a receipt ───────────────────
// URLs expire after 1 hour for security
export const getReceiptSignedUrl = async (s3Key) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
  return url;
};

// ── Delete a receipt from S3 ──────────────────────────────────
export const deleteReceiptFromS3 = async (s3Key) => {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
    }),
  );
};
