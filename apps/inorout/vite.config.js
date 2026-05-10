import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@platform/core": resolve(__dirname, "../../packages/core/index.js"),
      "@platform/ui":   resolve(__dirname, "../../packages/ui/index.jsx"),
    },
  },
});
