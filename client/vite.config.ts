import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Respects an externally-assigned port (e.g. when 5173 is already taken by another
    // session's dev server) while keeping 5173 as the default for a normal local run.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    rollupOptions: {
      output: {
        // React and the router change far less often than the app: in a chunk of their own, browsers
        // keep them cached across deploys. Pages (and the charting library) split off on their own
        // through the lazy routes in App.tsx.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
});
