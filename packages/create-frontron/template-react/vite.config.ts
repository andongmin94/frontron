import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  server: {
  port: 3000,
  host: "0.0.0.0",
  },
  plugins: [react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),, tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
