/**
 * 共有型定義: もやもや診断アプリ
 *
 * フロント(SPA)と Workers API が共有する契約。design.md「Data Models」に準拠する。
 */

// ============================================================
// 定数
// ============================================================

/** 診断の総質問数 (F-08/F-10)。q1〜q20 */
export const TOTAL_QUESTIONS = 20;

/** 有効な回答選択肢の集合 (リッカート尺度 0〜4) */
export const CHOICE_VALUES = ["0", "1", "2", "3", "4"] as const;

/** アンケート尺度 (clarity/conviction) の下限・上限 (1〜5) */
export const SURVEY_SCALE_MIN = 1;
export const SURVEY_SCALE_MAX = 5;

/** 自由記述の最大文字数 */
export const FREE_TEXT_MAX_LENGTH = 1000;

/** Factor.score の下限・上限 (0〜100) */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** 中断・再開に用いる localStorage キー (F-24) */
export const STORAGE_KEY = "moyamoya.session.v1";

// ============================================================
// 診断回答モデル
// ============================================================

/** 質問ID: "q1"〜"q20" */
export type QuestionId = `q${number}`;

/** 回答選択肢: 0〜4 のリッカート尺度。API仕様に合わせ文字列で保持 */
export type ChoiceValue = (typeof CHOICE_VALUES)[number];

/** 20問の回答。キーは q1..q20 */
export type DiagnosisAnswers = Record<QuestionId, ChoiceValue>;

// ============================================================
// 診断結果モデル
// ============================================================

/** 診断要因 */
export interface Factor {
  /** 例: "overwork", "relationship", "future_anxiety" */
  id: string;
  /** 表示名 (例: "働きすぎ") */
  label: string;
  /** 0..100 に正規化した重み付けスコア */
  score: number;
  /** F-13 要因詳細の説明文 */
  description: string;
  /** F-13 関係性: 関連する要因の id 配列 */
  relatedFactorIds: string[];
}

/** 診断結果 */
export interface DiagnosisResult {
  /** スコア降順ランキング (同点時は id 昇順) */
  factors: Factor[];
  /** 最大要因 (factors[0].id と一致) */
  topFactorId: string;
  /** 算出時刻 ISO8601 */
  computedAt: string;
}

// ============================================================
// アンケートモデル
// ============================================================

/** アンケート回答 (事前/事後共通の尺度) */
export interface SurveyAnswer {
  /** もやもや整理度 1..5 (F-04/F-14) */
  clarity: number;
  /** 納得度 1..5 (F-14のみ) */
  conviction?: number;
  /** 自由記述 (任意) */
  freeText?: string;
}

// ============================================================
// API 共通レスポンス型
// ============================================================

/** API 共通レスポンス形 (design.md「API設計」) */
export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fields?: string[] } };

// ============================================================
// アプリ共通エラー型 (F-20)
// ============================================================

/** アプリ内で扱う共通エラー (design.md Component 6: ErrorHandler) */
export type AppError =
  | { kind: "network"; retryable: true }
  | { kind: "validation"; fields: string[]; retryable: false }
  | { kind: "server"; status: number; retryable: boolean };
