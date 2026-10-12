// @ts-check
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "src/routeTree.gen.ts",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true, allowExportNames: ["Route"] }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // shadcn/ui primitives export variants next to components; test and config files are not refreshed.
    // Route files are split and hot-reloaded by the TanStack Router plugin; lib/ holds context
    // providers next to their hooks; shadcn/ui primitives export variants next to components.
    files: [
      "src/routes/**",
      "src/lib/**",
      "src/components/ui/**",
      "src/test/**",
      "**/*.test.{ts,tsx}",
      "e2e/**",
      "*.config.ts",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: ["*.config.{ts,js}", "e2e/**"],
    languageOptions: { globals: { ...globals.node } },
  },
);
