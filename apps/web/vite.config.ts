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
});
