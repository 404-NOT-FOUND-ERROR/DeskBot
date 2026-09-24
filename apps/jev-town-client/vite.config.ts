import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const SERVER_PORT = Number(process.env.PORT ?? 8787);
const CLIENT_PORT = Number(process.env.DESKBOT_WORLD_PORT ?? 5173);

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/jev-town/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    port: CLIENT_PORT,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // The lazily loaded 3D scene chunk is mostly Three.js itself (~135 kB gzipped).
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
