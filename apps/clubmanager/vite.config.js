import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Club Manager admin console — desktop-first web app.
// Mirrors apps/hq's config: the @platform/core alias lets us import the shared
// Supabase client + wrappers by subpath (e.g. @platform/core/storage/supabase.js).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@platform/core": resolve(__dirname, "../../packages/core") },
  },
});
