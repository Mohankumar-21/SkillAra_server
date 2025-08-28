import express from "express";
import tenantRouter from "./tenantRoutes.js";
const router = express.Router();

router.use("/tenants", tenantRouter);

export default router;
