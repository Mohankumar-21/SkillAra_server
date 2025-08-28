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
      "semi": ["error", "always"],
      "quotes": ["error", "double"]
    }
  }
]);
