// Dev on 5190, proxying /api to the ai-analyst server on 8788 (API_URL to change it). `base: "./"` plus the hash
// router lets the build work from any sub-path. VITE_API=fixtures builds the demo on the mock server into dist-demo/.
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.API_URL ?? "http://127.0.0.1:8788";
const DEMO = process.env.VITE_API === "fixtures";

export default defineConfig({
  base: "./",
  define: { __DEMO__: JSON.stringify(DEMO) },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5190,
    strictPort: true,
    // The server refuses cross-origin POSTs (Origin must match Host), so the proxy presents the API's own origin.
    proxy: {
      "/api": {
        target: API,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => req.setHeader("origin", API));
          // A server that is not running answers as "network", as it would without the proxy, not as a 502.
          proxy.on("error", (err, _req, res) => {
            if (!("writeHead" in res) || res.headersSent) return;
            res.writeHead(503, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: { code: "network", message: `Nothing answers at ${API}: ${err.message}`, params: {} } }));
          });
        },
      },
    },
  },
  build: { outDir: DEMO ? "dist-demo" : "dist", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
});
