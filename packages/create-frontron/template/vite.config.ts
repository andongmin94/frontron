import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import fs from "fs";

// package.json에서 포트 설정 가져오기
const packagePath = path.resolve(__dirname, "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const DEV_PORT = pkg.config?.port?.dev || 3000;

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: DEV_PORT,
    host: "0.0.0.0",
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
