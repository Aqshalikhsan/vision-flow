import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const localCacheRoot = process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, "Salnova", "vite-cache")
  : resolve(".cache", "vite");

export default defineConfig({
  plugins: [react()],
  // OneDrive can hold Vite's atomic .vite-temp rename for tens of seconds.
  // Keep disposable optimizer output on the local machine instead.
  cacheDir: process.env.VITE_CACHE_DIR || localCacheRoot,
  // This workspace also contains hundreds of thousands of dataset artifacts.
  // Avoid Vite's cold-start dependency crawl and pre-bundle the complete,
  // small frontend dependency set explicitly.
  optimizeDeps: {
    noDiscovery: true,
    holdUntilCrawlEnd: false,
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "lucide-react",
    ],
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/files": "http://127.0.0.1:8000",
    },
  },
  server: {
    host: true,
    // Never silently move to 5174 while users keep opening the documented
    // 5173 URL. A stale process should produce an explicit startup error.
    strictPort: true,
    watch: {
      // Training artifacts can be several GB and are not frontend sources.
      ignored: ["**/local_data/**", "**/dist/**", "**/.runtime/**"],
    },
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/files": "http://127.0.0.1:8000",
    },
  },
});
