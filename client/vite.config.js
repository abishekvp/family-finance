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
                target: "http://localhost:4000",
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: "dist",
    },
});
