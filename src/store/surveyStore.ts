/**
 * アンケートの設問定義と入力チェック (事前 F-04 / 事後 F-14)
 *
 * 設問は Box「12_現状整理/事前事後アンケート案.md」(2026-11-11 改訂) に準拠する。
 *   事前: P0 頻度 / P1 説明できる / P2 つながりが分かる / P3 原因 (複数選択) / 年代 (任意)
 *   事後: A1 説明できる / A2 つながりが分かる / A3 当てはまる / A4 気づいた / 感想 (任意)
 * B群 (比較群) は結果を見る前に事後アンケートに答えるため A3・A4 を聞かない。
 */

import { SURVEY_SCALE_MAX, SURVEY_SCALE_MIN } from "@/models/types";

// ============================================================
// 選択肢
// ============================================================

export interface Option<T> {
  value: T;
  label: string;
}

// 5段階 (値 1〜5。5 が肯定)。答えやすいよう肯定 (5) を上に並べる。値の意味は変えない。
// 質問文に合わせて言葉を変える (P1・A1 は「できる」、P2・A2 は「わかる」、A3・A4 は「そう思う」)。

/** P1・A1 説明できる */
export const EXPLAIN_OPTIONS: Option<number>[] = [
  { value: 5, label: "十分できる" },
  { value: 4, label: "ややできる" },
  { value: 3, label: "どちらともいえない" },
  { value: 2, label: "あまりできない" },
  { value: 1, label: "まったくできない" },
];

/** P2・A2 つながりが分かる */
export const UNDERSTAND_OPTIONS: Option<number>[] = [
  { value: 5, label: "よくわかる" },
  { value: 4, label: "ややわかる" },
  { value: 3, label: "どちらともいえない" },
  { value: 2, label: "あまりわからない" },
  { value: 1, label: "まったくわからない" },
];

/** A3 当てはまる・A4 気づいた (事後のみ) */
export const AGREE_OPTIONS: Option<number>[] = [
  { value: 5, label: "とてもそう思う" },
  { value: 4, label: "ややそう思う" },
  { value: 3, label: "どちらともいえない" },
  { value: 2, label: "あまりそう思わない" },
  { value: 1, label: "まったくそう思わない" },
];

/** P0 頻度 (1〜4) */
export const FREQUENCY_OPTIONS: Option<number>[] = [
  { value: 1, label: "よくある" },
  { value: 2, label: "ときどきある" },
  { value: 3, label: "あまりない" },
  { value: 4, label: "ほとんどない" },
];

export const CAUSE_NONE = 98;
export const CAUSE_UNKNOWN = 99;

/** P3 原因 (分類ID 1〜10 と 98・99)。98・99 はほかと同時に選べない */
export const CAUSE_OPTIONS: Option<number>[] = [
  { value: 1, label: "時間や気持ちに余裕がない" },
  { value: 2, label: "休んでも疲れが取れない" },
  { value: 3, label: "情報が多すぎて、頭が疲れる" },
  { value: 4, label: "人と比べて落ち込んでしまう" },
  { value: 5, label: "本音を話せる相手がいない、さびしい" },
  { value: 6, label: "将来が不安" },
  { value: 7, label: "周りの状況に振り回されている" },
  { value: 8, label: "理想の自分と今の自分に差がある" },
  { value: 9, label: "同じことを何度も考えてしまう" },
  { value: 10, label: "決められない、最初の一歩が踏み出せない" },
  { value: CAUSE_NONE, label: "どれも当てはまらない" },
  { value: CAUSE_UNKNOWN, label: "わからない" },
];

/** 年代 (任意) */
export const AGE_OPTIONS: Option<string>[] = [
  { value: "20s", label: "20代" },
  { value: "30s", label: "30代" },
  { value: "40s", label: "40代" },
  { value: "50plus", label: "50代以上" },
  { value: "no_answer", label: "回答しない" },
];

/** 事後アンケートの感想の上限文字数 */
export const COMMENT_MAX_LENGTH = 200;

// ============================================================
// 入力と検証
// ============================================================

export interface PreSurveyInput {
  frequency?: number;
  explain?: number;
  relation?: number;
  causes: number[];
  ageGroup?: string;
}

export type PreSurveyField = "frequency" | "explain" | "relation" | "causes" | "ageGroup";

export interface PostSurveyInput {
  explain?: number;
  relation?: number;
  fit?: number;
  discovery?: number;
  comment?: string;
}

export type PostSurveyField = "explain" | "relation" | "fit" | "discovery" | "comment";

export type Group = "A" | "B";

/** 1〜5 の整数か */
export function isValidScale(value: number | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SURVEY_SCALE_MIN &&
    value <= SURVEY_SCALE_MAX
  );
}

function isIn<T>(value: T | undefined, options: Option<T>[]): boolean {
  return value !== undefined && options.some((o) => o.value === value);
}

/** 事前アンケートの未入力・不正な項目を返す (空なら送信できる) */
export function validatePreSurvey(input: PreSurveyInput): PreSurveyField[] {
  const invalid: PreSurveyField[] = [];
  if (!isIn(input.frequency, FREQUENCY_OPTIONS)) invalid.push("frequency");
  if (!isValidScale(input.explain)) invalid.push("explain");
  if (!isValidScale(input.relation)) invalid.push("relation");
  const causes = input.causes;
  const exclusive = causes.some((c) => c === CAUSE_NONE || c === CAUSE_UNKNOWN);
  if (
    causes.length === 0 ||
    new Set(causes).size !== causes.length ||
    !causes.every((c) => isIn(c, CAUSE_OPTIONS)) ||
    (exclusive && causes.length > 1)
  ) {
    invalid.push("causes");
  }
  if (input.ageGroup !== undefined && !isIn(input.ageGroup, AGE_OPTIONS)) invalid.push("ageGroup");
  return invalid;
}

/** 事後アンケートの未入力・不正な項目を返す。B群は A3・A4 を聞かない */
export function validatePostSurvey(input: PostSurveyInput, group: Group): PostSurveyField[] {
  const invalid: PostSurveyField[] = [];
  if (!isValidScale(input.explain)) invalid.push("explain");
  if (!isValidScale(input.relation)) invalid.push("relation");
  if (group === "A") {
    if (!isValidScale(input.fit)) invalid.push("fit");
    if (!isValidScale(input.discovery)) invalid.push("discovery");
  }
  if ((input.comment ?? "").trim().length > COMMENT_MAX_LENGTH) invalid.push("comment");
  return invalid;
}

/**
 * P3 のチェックを切り替えたあとの選択を返す。
 * 98「どれも当てはまらない」・99「わからない」を選ぶとほかは外れ、
 * ほかを選ぶと 98・99 は外れる。
 */
export function toggleCause(current: number[], value: number, checked: boolean): number[] {
  if (!checked) return current.filter((c) => c !== value);
  if (value === CAUSE_NONE || value === CAUSE_UNKNOWN) return [value];
  const rest = current.filter((c) => c !== CAUSE_NONE && c !== CAUSE_UNKNOWN && c !== value);
  return [...rest, value].sort((a, b) => a - b);
}
