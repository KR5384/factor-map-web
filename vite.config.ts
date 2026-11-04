import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// Vite 設定: Cloudflare Pages への静的ビルド出力
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
