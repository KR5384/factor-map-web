/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** バックエンド API の接続先 (省略時は本番の factor-map-api) */
  readonly VITE_API_BASE_URL?: string;
}
