import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Vitest 設定: ユニット/プロパティテスト (fast-check) 実行環境
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
