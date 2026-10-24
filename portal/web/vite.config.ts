import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // SW_ONLY=portal builds just the portal (handy while the admin console is being worked on)
      input:
        process.env.SW_ONLY === "portal"
          ? { portal: resolve(__dirname, "index.html") }
          : { portal: resolve(__dirname, "index.html"), admin: resolve(__dirname, "admin/index.html") },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/files": "http://localhost:8080",
      "/library": "http://localhost:8080",
    },
  },
});
