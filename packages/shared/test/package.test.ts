import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as root from "../src";
import * as api from "../src/api";
import * as expr from "../src/expr";
import * as format from "../src/format";
import * as forms from "../src/forms";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
  name: string;
  type: string;
  main: string;
  types: string;
  exports: Record<string, string>;
  dependencies?: Record<string, string>;
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("package surface", () => {
  it("points main, types and every export at existing source files", () => {
    expect(pkg).toMatchObject({ name: "@ams/shared", type: "module", main: "./src/index.ts", types: "./src/index.ts" });
    expect(pkg.exports).toMatchObject({
      ".": "./src/index.ts",
      "./expr": "./src/expr/index.ts",
      "./forms": "./src/forms/index.ts",
      "./api": "./src/api/index.ts",
    });
    for (const target of Object.values(pkg.exports)) expect(existsSync(join(pkgDir, target)), target).toBe(true);
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("re-exports every module from the root", () => {
    for (const mod of [expr, forms, api, format]) {
      for (const name of Object.keys(mod)) {
        expect((root as Record<string, unknown>)[name], name).toBe((mod as Record<string, unknown>)[name]);
      }
    }
    for (const name of [
      "parse",
      "evaluate",
      "evaluateExpression",
      "references",
      "FUNCTION_NAMES",
      "RESERVED_WORDS",
      "validateSchema",
      "evaluateForm",
      "validateSubmission",
      "compileForm",
      "fieldKeys",
      "valueFields",
      "isEmptyValue",
      "errorMessage",
      "emptySchema",
      "newField",
      "slugifyKey",
      "moveField",
      "renameKeyInExpressions",
      "createApiClient",
      "ApiError",
      "queryKeys",
      "athleteLabel",
      "flagColor",
      "formatMetricValue",
      "terminology",
      "todayInTimeZone",
      "addDays",
      "dateRange",
    ]) {
      expect(typeof (root as Record<string, unknown>)[name], name).not.toBe("undefined");
    }
  });
});

describe("Hermes (React Native) compatibility of src/", () => {
  const files = sourceFiles(join(pkgDir, "src"));
  const banned: [RegExp, string][] = [
    [/\(\?<[=!]/, "regex lookbehind"],
    [/\(\?<[A-Za-z]/, "regex named groups"],
    [/\\p\{/, "regex Unicode property escapes"],
    [/\bObject\.hasOwn\(/, "Object.hasOwn"],
    [/\.at\(-?\d/, "Array.prototype.at"],
    [/\.replaceAll\(/, "String.prototype.replaceAll"],
    [/\bstructuredClone\(/, "structuredClone"],
    [/^\s*(static\s+)?#[a-z]/m, "private class fields"],
    [/\bfrom\s+["']node:/, "Node built-ins"],
    [/\bfrom\s+["'](?!\.)/, "runtime dependencies"],
  ];

  it.each(files.map((f) => [f.slice(pkgDir.length + 1), f] as const))("%s", (_rel, file) => {
    const src = readFileSync(file, "utf8");
    for (const [re, what] of banned) {
      expect(re.test(src), `${what} in ${file}`).toBe(false);
    }
  });
});
