import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
  },
  clearScreen: false,
  // Expose TAURI_* env vars to the frontend (e.g. TAURI_ENV_PLATFORM)
  envPrefix: ["VITE_", "TAURI_ENV_"],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // Prevent Vite from pre-bundling @tauri-apps packages.
  // They rely on window.__TAURI_INTERNALS__ which is only injected
  // by the Tauri WebView runtime — pre-bundling them causes Vite to
  // snapshot the module before that global exists.
  optimizeDeps: {
    exclude: [
      "@tauri-apps/api",
      "@tauri-apps/plugin-fs",
      "@tauri-apps/plugin-shell",
      "@tauri-apps/plugin-sql",
    ],
  },
}));
