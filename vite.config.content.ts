import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

/**
 * Content Script Vite config
 *
 * Produces exactly: dist/content.js (IIFE) + dist/content.css
 * No hashes, no code splitting — single self-contained files.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@content": resolve(__dirname, "src/content"),
    },
  },

  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },

  build: {
    outDir: "dist",
    emptyOutDir: false, // Preserve dashboard build

    lib: {
      entry: resolve(__dirname, "src/content/index.tsx"),
      name: "TopicHunterContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },

    rollupOptions: {
      output: {
        // Force CSS filename to content.css (not style.css)
        assetFileNames: "content[extname]",
      },
    },

    minify: true,
    cssCodeSplit: false,
    modulePreload: false,
  },
});
