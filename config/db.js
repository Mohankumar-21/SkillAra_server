import mongoose from "mongoose";
import logger from "../core/logger.js";

const connectToDb = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    logger.error("MONGO_URI is missing. Create SkillAra_server/.env with your MongoDB connection string.");
    if (process.env.NODE_ENV === "production") process.exit(1);
    return;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log("✅ MongoDB connected");
  } catch (err) {
    const msg = err?.message || String(err);
    logger.error(`MongoDB connection failed: ${msg}`);

    if (msg.includes("ENOTFOUND") || msg.includes("querySrv")) {
      logger.error(
        "DNS could not resolve your MongoDB Atlas host. Check: (1) MONGO_URI is correct, (2) cluster exists in Atlas, (3) internet/DNS works, (4) IP is whitelisted in Atlas Network Access."
      );
    }

    // In dev, don't hard-crash nodemon on DNS/connectivity issues
    if (process.env.NODE_ENV === "production") process.exit(1);
  }
};

export default connectToDb;
