import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { adminApi } from "./scripts/vite-admin-plugin.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [adminApi()],
  server: { host: "127.0.0.1", port: 5173 },
  preview: { host: "127.0.0.1", port: 4174 },
  build: {
    rollupOptions: {
      input: {
        main: `${root}/index.html`,
        admin: `${root}/admin.html`,
      },
    },
  },
});
