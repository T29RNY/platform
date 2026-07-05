import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  // Baked at build time so the running bundle can report which version it is (support diagnostic —
  // tells you at a glance if a user is on a stale cached bundle). Vercel provides
  // VERCEL_GIT_COMMIT_SHA at build; falls back to "dev" for local builds.
  define: {
    "import.meta.env.VITE_BUILD_SHA": JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7)),
    "import.meta.env.VITE_BUILD_DATE": JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  resolve: {
    alias: {
      "@platform/core":     resolve(__dirname, "../../packages/core"),
      "@platform/ui":       resolve(__dirname, "../../packages/ui"),
    },
  },
});