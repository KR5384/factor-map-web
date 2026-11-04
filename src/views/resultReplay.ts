/**
 * ResultReplay (診断結果再表示 F-25 / Requirement 17「要検討」)
 *
 * 完了画面 (CompleteView) の onReplayResult 導線に結線し、localStorage に保持された
 * DiagnosisResult を検証したうえで診断マップを再描画する。保持結果が無効・不在の場合は
 * 再描画せず、利用できる診断結果が存在しない旨の通知を表示する。
 *
 * 要件対応 (Requirement 17):
 *   - 17.1 再表示が有効なとき、完了画面に有効状態の再表示導線を提示する
 *          (導線の提示自体は CompleteView が onReplayResult の有無で制御する。
 *           本モジュールは有効な onReplayResult ハンドラを供給することで導線を有効化する)
 *   - 17.2 保持された DiagnosisResult が存在し factors(score降順)・topFactorId・computedAt を
 *          規定の型/範囲で含むとき、保持された並び順および topFactorId を用いてマップを再描画する
 *   - 17.3 不在 / JSON不正 / キー欠落 / 範囲外のとき、再描画せず完了画面を保持したまま
 *          再表示に利用できる結果が無い旨の通知を表示する
 *
 * 設計方針:
 *   - 検証は受け取った raw を一切変更せず行う。factors の並び順は保持値のまま用い、
 *     ResultView 側で確定済みの score 降順 (同点 id 昇順) をそのまま尊重する。
 *   - フレームワーク非依存 (Vanilla TS DOM)。
 */

import type { DiagnosisResult, Factor } from "@/models/types";
import { SCORE_MAX, SCORE_MIN } from "@/models/types";
import type { MapRenderer } from "@/views/mapRenderer";

// ============================================================
// 保持キー
// ============================================================

/**
 * 診断結果の再表示用 localStorage キー (F-25)。
 *
 * 中断・再開用のセッションキー (STORAGE_KEY = "moyamoya.session.v1") とは
 * 役割が異なるため、専用キーで DiagnosisResult を保持する。
 */
export const RESULT_STORAGE_KEY = "moyamoya.result.v1";

// ============================================================
// 保持 (persist)
// ============================================================

/**
 * persistResult: DiagnosisResult を localStorage の再表示用キーへ保存する。
 *
 * 書込に失敗 (容量超過・無効化等) しても例外を投げず黙って無視する。保存の成否は
 * 本来のフロー (結果描画・遷移) を妨げないため、呼び出し側は結果を気にしなくてよい。
 */
export function persistResult(result: DiagnosisResult): void {
  try {
    localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(result));
  } catch {
    // ストレージ書込失敗は再表示機能の可否に影響するだけで、本流は継続する。
  }
}

// ============================================================
// 検証 (validate)
// ============================================================

/** 有限な数値か。 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** score が規定範囲 [SCORE_MIN, SCORE_MAX] の有限数か。 */
function isValidScore(value: unknown): value is number {
  return isFiniteNumber(value) && value >= SCORE_MIN && value <= SCORE_MAX;
}

/** 非空文字列か。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** 文字列配列か (関連要因ID)。 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * validateFactor: 1 件の Factor が規定の型/範囲を満たすか検証する。
 *
 * - id: 非空文字列
 * - label: 非空文字列
 * - score: 0..100 の有限数 (Req 17.2/17.3 の「規定範囲」)
 * - description: 文字列 (空文字は許容。説明が無い要因もあり得るため)
 * - relatedFactorIds: 文字列配列 (空配列可)
 *
 * いずれかのキーが欠落、または型/範囲が不正なら null を返す。妥当なら
 * 正規化済み (余計なキーを含まない) Factor を返す。
 */
function validateFactor(raw: unknown): Factor | null {
  if (raw === null || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;

  if (!isNonEmptyString(f.id)) return null;
  if (!isNonEmptyString(f.label)) return null;
  if (!isValidScore(f.score)) return null;
  if (typeof f.description !== "string") return null;
  if (!isStringArray(f.relatedFactorIds)) return null;

  return {
    id: f.id,
    label: f.label,
    score: f.score,
    description: f.description,
    relatedFactorIds: [...f.relatedFactorIds],
  };
}

/**
 * validateStoredResult: localStorage の生文字列から DiagnosisResult を検証・復元する。
 *
 * 次のいずれかに該当する場合は null を返す (Req 17.3):
 *   - 不在 (raw が null / 空文字)
 *   - JSON として解釈できない
 *   - factors / topFactorId / computedAt のいずれかがキー欠落
 *   - factors が配列でない、または空
 *   - 各 Factor の型/範囲が不正 (score が 0..100 の範囲外を含む)
 *   - topFactorId が非空文字列でない、または factors[0].id と一致しない
 *     (保持値は score 降順の先頭が最大要因であるという不変条件を検証する)
 *   - computedAt が非空文字列でない
 *
 * 妥当な場合は、factors の並び順を保持値のまま維持した DiagnosisResult を返す。
 *
 * @param raw localStorage.getItem(RESULT_STORAGE_KEY) の戻り値相当。
 */
export function validateStoredResult(raw: string | null): DiagnosisResult | null {
  // 不在 (Req 17.3)。
  if (raw === null || raw.length === 0) return null;

  // JSON 解釈 (Req 17.3)。
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  // キー存在チェック (Req 17.3)。
  if (!("factors" in obj) || !("topFactorId" in obj) || !("computedAt" in obj)) {
    return null;
  }

  // factors は非空配列であること。
  if (!Array.isArray(obj.factors) || obj.factors.length === 0) return null;

  // 各 Factor を検証。保持値の並び順を維持する (Req 17.2)。
  const factors: Factor[] = [];
  for (const rawFactor of obj.factors) {
    const factor = validateFactor(rawFactor);
    if (factor === null) return null;
    factors.push(factor);
  }

  // factors が score 降順 (同点 id 昇順) であることを検証する。
  // 保持結果は確定時にこの順で生成される前提であり、改ざん・破損を検出する。
  for (let i = 1; i < factors.length; i++) {
    const prev = factors[i - 1];
    const curr = factors[i];
    if (curr.score > prev.score) return null;
    if (curr.score === prev.score && curr.id < prev.id) return null;
  }

  // topFactorId の検証 (Req 17.2/17.3)。非空文字列かつ最大要因 (先頭) と一致すること。
  if (!isNonEmptyString(obj.topFactorId)) return null;
  if (obj.topFactorId !== factors[0].id) return null;

  // computedAt の検証 (Req 17.3)。非空文字列であること。
  if (!isNonEmptyString(obj.computedAt)) return null;

  return {
    factors,
    topFactorId: obj.topFactorId,
    computedAt: obj.computedAt,
  };
}

// ============================================================
// ResultReplay ヘルパ
// ============================================================

/** createResultReplay の依存一式。 */
export interface ResultReplayDeps {
  /** 診断マップ描画。再描画に用いる (Req 17.2)。 */
  mapRenderer: MapRenderer;
  /**
   * 再描画先コンテナを供給する関数。完了画面を保持したまま、その内側 (または近傍) に
   * マップを描画できるよう呼び出し側が提供する。
   */
  getMapContainer: () => HTMLElement;
  /**
   * 再表示に利用できる結果が存在しない旨の通知表示 (Req 17.3)。
   * 完了画面は保持したまま呼び出される。
   */
  showNoResultNotice: (message: string) => void;
  /**
   * localStorage 取得の差し替え口 (テスト容易性)。既定では
   * localStorage.getItem(RESULT_STORAGE_KEY) を用いる。
   */
  readRawResult?: () => string | null;
}

/** 再表示機能の公開契約。 */
export interface ResultReplay {
  /**
   * replay: CompleteView の onReplayResult に結線するハンドラ。
   *
   * - 保持結果が妥当なら同一並び順・同一 topFactorId でマップを再描画し true を返す (Req 17.2)。
   * - 不在/不正なら再描画せず通知を表示し false を返す (Req 17.3)。
   */
  replay(): boolean;
}

/** 再表示に利用できる結果が無い場合の通知文言。 */
export const NO_RESULT_MESSAGE = "再表示に利用できる診断結果が存在しません。";

/**
 * createResultReplay: 完了画面の結果再表示 (F-25 / Req 17) を提供するヘルパを生成する。
 *
 * 返り値の `replay` を CompleteView の onReplayResult に渡すことで、完了画面に
 * 有効状態の再表示導線が提示される (Req 17.1 は onReplayResult を供給することで満たす)。
 */
export function createResultReplay(deps: ResultReplayDeps): ResultReplay {
  const {
    mapRenderer,
    getMapContainer,
    showNoResultNotice,
    readRawResult = () => {
      try {
        return localStorage.getItem(RESULT_STORAGE_KEY);
      } catch {
        // ストレージ読取失敗は「利用できる結果が無い」と同義に扱う。
        return null;
      }
    },
  } = deps;

  return {
    replay(): boolean {
      const result = validateStoredResult(readRawResult());

      // 不在/JSON不正/キー欠落/範囲外は再描画せず通知する (Req 17.3)。
      if (result === null) {
        showNoResultNotice(NO_RESULT_MESSAGE);
        return false;
      }

      // 妥当なら保持された並び順・topFactorId でマップを再描画する (Req 17.2)。
      // MapRenderer は与えられた DiagnosisResult から決定的に描画するため、
      // 保持値の factors 並び順と topFactorId がそのままマップへ反映される。
      mapRenderer.render(getMapContainer(), result);
      return true;
    },
  };
}
