import mongoose from "mongoose";
const connectToDb = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error(err.message);
    // In dev, don't hard-crash nodemon on DNS/connectivity issues
    if (process.env.NODE_ENV !== "production") return;
    process.exit(1);
  }
};
export default connectToDb;
