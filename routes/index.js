import express from "express";
import tenantRouter from "./tenantRoutes.js";
import authRouter from "./authRoutes.js";
import planRouter from "./planRoutes.js";
import courseRouter from "./courseRoutes.js";
import aiRouter from "./aiRoutes.js";
import assignmentRouter from "./assignmentRoutes.js";
import userRouter from "./userRoutes.js";
import enrollmentRouter from "./enrollmentRoutes.js";
import progressRouter from "./progressRoutes.js";
import quizRouter from "./quizRoutes.js";
import ownershipTransferRouter from "./ownershipTransferRoutes.js";
const router = express.Router();

router.use("/auth", authRouter);
router.use("/users", userRouter);
router.use("/enrollments", enrollmentRouter);
router.use("/progress", progressRouter);
router.use("/quizzes", quizRouter);
router.use("/tenants", tenantRouter);
router.use("/plans", planRouter);
router.use("/courses", courseRouter);
router.use("/ai", aiRouter);
router.use("/assignments", assignmentRouter);
router.use("/ownership-transfers", ownershipTransferRouter);

export default router;

