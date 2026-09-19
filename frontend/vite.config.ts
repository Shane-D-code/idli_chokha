import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    dedupe: ["three"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/maplibre-gl")) return "vendor-maps";
          if (
            id.includes("node_modules/three") ||
            id.includes("node_modules/three-globe") ||
            id.includes("node_modules/react-globe.gl")
          ) {
            return "vendor-globe";
          }
          if (id.includes("node_modules/recharts")) return "vendor-charts";
        },
      },
    },
  },
});
