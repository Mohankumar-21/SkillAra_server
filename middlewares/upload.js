import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { prepareResponseMsg } from "../utils/helper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "video/mp4",
  "video/webm",
];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (ALLOWED_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("File type not allowed"));
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024 },
});

export function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    return res
      .status(400)
      .send(prepareResponseMsg({}, false, err.message, 400));
  }
  if (err) {
    return res.status(400).send(prepareResponseMsg({}, false, err.message, 400));
  }
  return next();
}
