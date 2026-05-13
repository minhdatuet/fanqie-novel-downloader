import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [
        react()
    ],
    server: {
        proxy: {
            "/api": {
                changeOrigin: true,
                target: "http://localhost:8787"
            }
        }
    }
});
