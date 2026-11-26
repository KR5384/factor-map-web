/**
 * アプリ設定 (API の接続先・同意文の版・テストモード)
 *
 * - API_BASE_URL: ビルド時の環境変数 VITE_API_BASE_URL で上書きできる
 *   (ローカルのバックエンドにつなぐとき: VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev)
 * - テストモード: 画面 URL に ?test=1 を付けて開くと、そのタブの間は X-Test-Mode: 1 を付けて送る
 *   (バックエンド側で is_test=1 として保存され、分析から外れる)
 */

export const DEFAULT_API_BASE_URL = "https://factor-map-api.east-10g.workers.dev";

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || DEFAULT_API_BASE_URL;

/** 利用同意文の版。同意画面の文言を変えたら上げる (DB の consent_version に保存される) */
export const CONSENT_VERSION = "2026-11-v2"; // v2: 要約3点＋詳しい説明 (2026-11-26)

/** フロントの版。結果画面の見せ方などを変えたら上げる (DB の client_version に保存される) */
export const CLIENT_VERSION = "web-0.3.0"; // 0.3.0: 円 (最大5つ)＋タイプの線＋タイプ名の結果画面 (2026-11-20)

const TEST_MODE_KEY = "moyamoya.testMode";

/** 起動時に 1 回呼ぶ。URL に ?test=1 があればテストモードをそのタブに記録する */
export function initTestModeFromUrl(search: string = location.search): void {
  try {
    if (new URLSearchParams(search).get("test") === "1") {
      sessionStorage.setItem(TEST_MODE_KEY, "1");
    }
  } catch {
    // sessionStorage が使えない環境では何もしない (テストモードにならないだけ)
  }
}

/** テストモードか (X-Test-Mode ヘッダーを付けるか) */
export function isTestMode(): boolean {
  try {
    return sessionStorage.getItem(TEST_MODE_KEY) === "1";
  } catch {
    return false;
  }
}
