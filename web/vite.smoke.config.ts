// Bundles scripts/smoke.tsx for Bun (resolves import.meta.glob and the @ alias). Used by `bun run smoke`.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // The smoke renders the fixtures build (the tour, the reviewer menu); smoke:http passes SMOKE_URL at run time.
  define: { "import.meta.env.VITE_API": JSON.stringify("fixtures"), __DEMO__: "true" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    ssr: "scripts/smoke.tsx",
    outDir: ".smoke",
    emptyOutDir: true,
    rolldownOptions: { output: { codeSplitting: false } },
  },
  logLevel: "warn",
});
