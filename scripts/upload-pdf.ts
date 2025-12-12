import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Configuration for local S3
const s3Config = {
  region: "us-east-1",
  endpoint: "http://localhost:9000",
  credentials: {
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
  },
  forcePathStyle: true,
};

const s3Client = new S3Client(s3Config);
const BUCKET_NAME = "downloads";
const FILE_ID = 70000;
const KEY = `downloads/${FILE_ID}.zip`; // App expects .zip for downloads

async function uploadPdf() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const projectRoot = path.dirname(__dirname);
    const pdfPath = path.join(
      projectRoot,
      "documents",
      "file-example_PDF_1MB.pdf",
    );

    console.log(`Reading file from ${pdfPath}...`);
    const fileContent = await readFile(pdfPath);

    console.log(`Uploading to s3://${BUCKET_NAME}/${KEY}...`);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: KEY,
        Body: fileContent,
        ContentType: "application/pdf", // or application/zip if we were strictly following the naming
      }),
    );

    console.log("Upload successful!");
    console.log("File ID:", FILE_ID);
  } catch (err) {
    console.error("Upload failed:", err);
    process.exit(1);
  }
}

uploadPdf();
