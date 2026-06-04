import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

/**
 * Main Vite config — builds Dashboard (HTML) + Service Worker
 * Content script is built separately via vite.config.content.ts
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@pages": resolve(__dirname, "src/pages"),
      "@background": resolve(__dirname, "src/background"),
      "@content": resolve(__dirname, "src/content"),
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,

    rollupOptions: {
      input: {
        // Full-page dashboard app (React)
        dashboard: resolve(__dirname, "src/pages/dashboard/index.html"),

        // Background service worker (no HTML — raw TS entry)
        "service-worker": resolve(__dirname, "src/background/service-worker.ts"),
      },

      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "service-worker") {
            return "service-worker.js";
          }
          return "assets/[name]-[hash].js";
        },

        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },

    minify: true,
    modulePreload: false,
  },

  server: {
    port: 5173,
    strictPort: true,
    open: "/src/pages/dashboard/index.html",
  },
});
