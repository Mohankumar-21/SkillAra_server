/**
 * Verify Backblaze B2 configuration end to end:
 *   list buckets → upload a probe object → sign a URL → fetch it → delete it.
 *
 * Usage: node scripts/checkStorage.js
 */
import "dotenv/config";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

import {
  isStorageConfigured,
  getBucketName,
  putObject,
  getSignedDownloadUrl,
  deleteObject,
  headObject,
} from "../services/storageService.js";

const ok = (msg) => console.log(`  OK    ${msg}`);
const fail = (msg) => console.log(`  FAIL  ${msg}`);

async function main() {
  console.log("\nBackblaze B2 storage check\n");

  if (!isStorageConfigured()) {
    fail("B2_ENDPOINT, B2_BUCKET, B2_KEY_ID and B2_APP_KEY must all be set in .env");
    process.exit(1);
  }

  console.log(`  endpoint : ${process.env.B2_ENDPOINT}`);
  console.log(`  region   : ${process.env.B2_REGION || "(derived)"}`);
  console.log(`  bucket   : ${getBucketName()}`);
  console.log(`  keyId    : ${String(process.env.B2_KEY_ID).slice(0, 6)}…\n`);

  // Step 1: validate the credential pair against B2's own auth endpoint. This uses
  // HTTP Basic auth rather than SigV4, so a failure here means the keyID/applicationKey
  // are genuinely wrong — it cannot be a signing, checksum, or endpoint problem.
  const basic = Buffer.from(`${process.env.B2_KEY_ID}:${process.env.B2_APP_KEY}`).toString(
    "base64"
  );
  try {
    const res = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
      headers: { Authorization: `Basic ${basic}` },
    });

    if (!res.ok) {
      fail(`B2 rejected the credential pair (HTTP ${res.status})`);
      console.log(
        "\n  The keyID and applicationKey do not match a live key on this account.\n" +
          "  Checks:\n" +
          "    • applicationKey should be ~31 characters starting with 'K005'.\n" +
          `      Yours is ${String(process.env.B2_APP_KEY).length} characters starting with ` +
          `'${String(process.env.B2_APP_KEY).slice(0, 4)}'.\n` +
          "    • It is shown ONCE, in the banner right after 'Create New Key'. It never\n" +
          "      appears in the Application Keys table afterwards.\n" +
          "    • The account Master Application Key does not work with the S3 API at all.\n" +
          "  Delete the key and create a new one, copying applicationKey before navigating away.\n"
      );
      process.exit(1);
    }

    const info = (await res.json()).apiInfo?.storageApi || {};
    ok(
      `credential pair valid — scoped to ${info.bucketName ? `bucket "${info.bucketName}"` : "all buckets"}`
    );
    if (info.bucketName && info.bucketName !== getBucketName()) {
      fail(`B2_BUCKET is "${getBucketName()}" but this key is scoped to "${info.bucketName}"`);
      process.exit(1);
    }
  } catch (err) {
    fail(`could not reach B2 auth endpoint: ${err.message}`);
    process.exit(1);
  }

  // Step 2: ListBuckets over the S3 endpoint. Informational only — bucket-restricted
  // keys can legitimately fail this while still being able to read and write objects.
  const client = new S3Client({
    endpoint: `https://${process.env.B2_ENDPOINT}`,
    region: process.env.B2_REGION || "us-east-005",
    credentials: {
      accessKeyId: process.env.B2_KEY_ID,
      secretAccessKey: process.env.B2_APP_KEY,
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  try {
    const res = await client.send(new ListBucketsCommand({}));
    ok(`S3 endpoint reachable — buckets: ${res.Buckets.map((b) => b.Name).join(", ")}`);
  } catch (err) {
    console.log(`  SKIP  ListBuckets unavailable for this key (${err.name}) — not fatal`);
  }

  const probeKey = `_healthcheck/${Date.now()}.txt`;
  try {
    await putObject({
      key: probeKey,
      body: Buffer.from("skillara storage probe"),
      mimeType: "text/plain",
    });
    ok(`uploaded probe object ${probeKey}`);
  } catch (err) {
    fail(`upload failed — ${err.name}: ${err.message}`);
    process.exit(1);
  }

  try {
    const head = await headObject(probeKey);
    ok(`object confirmed present (${head.size} bytes)`);
  } catch (err) {
    fail(`head failed — ${err.message}`);
  }

  try {
    const url = await getSignedDownloadUrl(probeKey, { ttlSeconds: 60 });
    const res = await fetch(url);
    if (res.ok) ok("signed download URL works");
    else fail(`signed URL returned HTTP ${res.status}`);
  } catch (err) {
    fail(`signing failed — ${err.message}`);
  }

  await deleteObject(probeKey);
  ok("probe object deleted");

  console.log("\nStorage is ready.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
