import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Three pages from one build: the field app (/), the QR public form (/q/) and the admin console (/admin/).
// SW_ONLY=field|admin|q builds just one of them while working on it.
const pages: Record<string, string> = {
  field: resolve(__dirname, "index.html"),
  q: resolve(__dirname, "q/index.html"),
  admin: resolve(__dirname, "admin/index.html"),
};
const only = process.env.SW_ONLY;

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: only && pages[only] ? { [only]: pages[only] } : pages },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8080", "/files": "http://localhost:8080", "/library": "http://localhost:8080" },
  },
});
