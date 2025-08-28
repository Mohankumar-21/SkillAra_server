import express from "express";
import createTenant from "../controllers/tenantController.js";
const tenantRouter = express.Router();

tenantRouter.post("/", createTenant);   // POST /tenants

export default tenantRouter;