/**
 * Contract check: every type in the ```ts block of docs/API.md must exist in
 * src/api/types.ts and be *identical* to it (same field names, optionality and types).
 * The block is compiled as-is with the TypeScript compiler and compared type by type.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, "..");
const apiMd = readFileSync(resolve(pkgDir, "../../docs/API.md"), "utf8");

function contractBlock(): string {
  const m = /## Types\s+```ts\n([\s\S]*?)```/.exec(apiMd);
  if (!m) throw new Error("no ts block under '## Types' in docs/API.md");
  return m[1]!;
}

const block = contractBlock();
const typeNames = Array.from(new Set(Array.from(block.matchAll(/(?:^|[;\s])type (\w+)/g), (m) => m[1]!)));

function compile(files: Record<string, string>): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
    types: [],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const original = { getSourceFile: host.getSourceFile, fileExists: host.fileExists, readFile: host.readFile };
  host.fileExists = (f) => f in files || original.fileExists(f);
  host.readFile = (f) => files[f] ?? original.readFile(f);
  host.getSourceFile = (f, lang, ...rest) =>
    f in files ? ts.createSourceFile(f, files[f]!, lang) : original.getSourceFile(f, lang, ...rest);
  const program = ts.createProgram(Object.keys(files), options, host);
  return ts.getPreEmitDiagnostics(program);
}

describe("docs/API.md types", () => {
  it("finds the contract types", () => {
    expect(typeNames.length).toBeGreaterThan(60);
    expect(typeNames).toContain("Athlete");
    expect(typeNames).toContain("ReadinessBoard");
  });

  it("are all exported by src/api/types.ts with identical structure", () => {
    const typesPath = join(pkgDir, "src/api/types.ts").replace(/\\/g, "/");
    const formsPath = join(pkgDir, "src/forms/types.ts").replace(/\\/g, "/");
    const contractPath = join(here, "__virtual_api_md__.ts").replace(/\\/g, "/");
    const checkPath = join(here, "__virtual_contract_check__.ts").replace(/\\/g, "/");

    const contract =
      `import type { FormSchema } from ${JSON.stringify(formsPath.replace(/\.ts$/, ""))};\n` +
      block.replace(/(^|[;\s])type (\w+)/g, "$1export type $2");
    const strictEqual = "type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;";
    const generic = (name: string) => (new RegExp(`type ${name}<`).test(block) ? "<unknown>" : "");
    const check = [
      `import type * as Doc from ${JSON.stringify(contractPath.replace(/\.ts$/, ""))};`,
      `import type * as Ours from ${JSON.stringify(typesPath.replace(/\.ts$/, ""))};`,
      strictEqual,
      ...typeNames.map(
        (n) => `export const check_${n}: Equal<Doc.${n}${generic(n)}, Ours.${n}${generic(n)}> = true;`,
      ),
    ].join("\n");

    const diagnostics = compile({ [contractPath]: contract, [checkPath]: check });
    const messages = diagnostics.map((d) => {
      const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      if (!d.file || d.start === undefined) return text;
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      return `${d.file.fileName.split("/").pop()}:${line + 1}: ${d.file.text.split("\n")[line]?.trim()} -> ${text}`;
    });
    expect(messages).toEqual([]);
  });
});
