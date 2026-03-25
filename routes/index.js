import express from "express";
import tenantRouter from "./tenantRoutes.js";
import authRouter from "./authRoutes.js";
import planRouter from "./planRoutes.js";
const router = express.Router();

router.use("/auth", authRouter);
router.use("/tenants", tenantRouter);
router.use("/plans", planRouter);

export default router;
