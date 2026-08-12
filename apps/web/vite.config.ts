import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phase 0: the web dev server proxies API + WebSocket to the control server.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5174",
        changeOrigin: false,
      },
      "/ws": {
        target: "ws://127.0.0.1:5174",
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // CodeMirror + language packs are only used by the Files tab
          // (lazy-loaded, issue #19); keeping them in one vendor chunk
          // avoids duplicated editor internals across the lang packs.
          codemirror: [
            "@uiw/react-codemirror",
            "@codemirror/lang-css",
            "@codemirror/lang-html",
            "@codemirror/lang-javascript",
            "@codemirror/lang-json",
            "@codemirror/lang-markdown",
            "@codemirror/lang-python",
          ],
        },
      },
    },
    // The Files/CodeMirror vendor chunk is ~675 KB but loads on demand
    // only when the Files tab opens; the initial bundle stays at ~265 KB.
    // The limit is raised deliberately for this documented exception
    // (issue #19).
    chunkSizeWarningLimit: 700,
  },
});
