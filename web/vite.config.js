import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API server runs on PORT (default 6171, npm start) and Vite on VITE_PORT (default 6173). /api and /mock are proxied,
// so the browser only ever talks to one origin (the server's Host check and same-origin writes stay satisfied).
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 6171}` };

export default defineConfig({
  plugins: [react()],
  // docs/talk-track.md is imported as text for the Talk track tab, so the dev server may read the repo root.
  server: { fs: { allow: [".."] }, host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 6173, strictPort: true, proxy: { "/api": api, "/mock": api } },
  // The mock server is loaded by Node itself in tests, so its data files resolve normally.
  test: { testTimeout: Number(process.env.WEB_TEST_TIMEOUT) || 20000, hookTimeout: Number(process.env.WEB_TEST_TIMEOUT) || 20000, environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", server: { deps: { external: [/\/(server|core)\/src\//] } } },
});
