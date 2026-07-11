/** Paste at the top of tenant-scoped route files (see eslint.config.mjs). */
export const TENANT_ROUTE_CHECKLIST = `
TENANT-SCOPED ROUTES — REVIEW CHECKLIST
All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
Never trust tenant id from req.query, req.body, or req.params.
`.trim();
