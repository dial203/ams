// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["node_modules/**", "coverage/**", "dist/**"] },
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      // Hermes (React Native) lacks some newer built-ins; tsconfig `lib: ES2020` catches most.
      "no-restricted-properties": [
        "error",
        { object: "Object", property: "hasOwn", message: "Not available on Hermes; use hasOwn() from src/util." },
        { object: "globalThis", property: "structuredClone", message: "Not available on Hermes." },
      ],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
