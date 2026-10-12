// @ts-check
import js from "@eslint/js";
import expo from "eslint-plugin-expo";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["node_modules/**", ".expo/**", "dist/**", "android/**", "ios/**", "vendor/**", "coverage/**", "expo-env.d.ts"] },
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  reactHooks.configs.flat["recommended-latest"],
  {
    plugins: { expo },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // EXPO_PUBLIC_* variables are inlined at build time only when accessed statically.
      "expo/no-dynamic-env-var": "error",
      "expo/no-env-var-destructuring": "error",
      // Hermes lacks some newer built-ins (same rule as @ams/shared).
      "no-restricted-properties": [
        "error",
        { object: "Object", property: "hasOwn", message: "Not available on Hermes." },
        { object: "globalThis", property: "structuredClone", message: "Not available on Hermes." },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.cjs", "app.config.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx", "jest.setup.tsx", "src/test/**"],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
