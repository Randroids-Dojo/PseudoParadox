import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  optimizeDeps: {
    // rapier3d-compat ships WASM via the JS bundle, no special config needed.
    exclude: [],
  },
});
