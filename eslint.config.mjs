import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
    plugins: { js },
    extends: ["js/recommended"],
    rules: {
      "no-unused-vars": "warn",
      semi: ["error", "always"],
      quotes: ["error", "double"],
    },
  },
  /*
   * Code-review checklist (tenant-scoped route files):
   * - courseRoutes.js, userRoutes.js, enrollmentRoutes.js, progressRoutes.js,
   *   quizRoutes.js, assignmentRoutes.js, aiRoutes.js, ownershipTransferRoutes.js
   * All DB queries MUST filter by req.tenantId from scopeTenant middleware.
   * Never trust tenant id from req.query / req.body / req.params.
   * See middleware/tenantRouteChecklist.js
   */
]);
