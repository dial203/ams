import { rmSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  // The in-browser demo (src/demo): `vite build --mode demo` or VITE_DEMO=1. Relative asset
  // URLs so one build works at a domain root and under a sub-path (GitHub Pages /ams/).
  const demo = mode === "demo" || process.env.VITE_DEMO === "1";
  return {
    base: demo ? "./" : "/",
    define: { "import.meta.env.VITE_DEMO": JSON.stringify(demo ? "1" : "") },
    plugins: [
      tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double" }),
      react(),
      tailwindcss(),
      {
        // public/demo holds generated demo fixtures (git-ignored); only the demo build ships them
        name: "ams-demo-fixtures-only-in-demo",
        apply: "build",
        closeBundle() {
          if (!demo) rmSync(fileURLToPath(new URL("./dist/demo", import.meta.url)), { recursive: true, force: true });
        },
      },
    ],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: { port: 5173 },
    preview: { port: 4173 },
  };
});
