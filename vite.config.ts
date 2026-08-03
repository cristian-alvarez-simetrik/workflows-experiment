import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base so the build works from any path (GitHub Pages subpath).
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  optimizeDeps: {
    // PGlite ships WASM assets that break under Vite's dep pre-bundling.
    exclude: ["@electric-sql/pglite"],
  },
});
