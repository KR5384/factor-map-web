/**
 * 診断エンジン (ルールベース): 回答から要因スコアを算出する純粋関数。
 *
 * design.md「要因スコア算出アルゴリズム (F-11)」に準拠。
 * AI/外部APIに依存せず、`QuestionWeight[]` の重み定義のみで決定的に算出する。
 *
 * 対応要件: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import type {
  ChoiceValue,
  DiagnosisAnswers,
  DiagnosisResult,
  Factor,
  QuestionId,
} from "@/models/types";
import { SCORE_MAX, SCORE_MIN } from "@/models/types";

// ============================================================
// 診断ロジックの入力型
// ============================================================

/**
 * 質問 → 要因への重み付け定義 (questions.json に外出しされる想定)。
 * 正の重みは要因を強め、負の重みは弱める。
 */
export interface QuestionWeight {
  questionId: QuestionId;
  /** factorId → 重み */
  weights: Record<string, number>;
}

/** 要因のメタ情報 (表示名・説明・関連要因)。 */
export interface FactorMeta {
  id: string;
  label: string;
  description: string;
  relatedFactorIds: string[];
}

// ============================================================
// ヘルパ
// ============================================================

/** 値を [lo, hi] の範囲に収める。 */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============================================================
// diagnose
// ============================================================

/**
 * diagnose: 回答から要因スコアを算出する純粋関数。
 *
 * 事前条件:
 *   - answers は q1..q20 の全キーを持ち、各値は "0".."4"
 *   - weightTable は全要因・全質問の重みを網羅
 *   - 各要因の最大可能点 > 0 (0 の場合は 1 として扱い 0 除算を回避)
 * 事後条件:
 *   - 返り値 factors の各 score は 0..100 の整数 (Req 9.3)
 *   - factors は score 降順。score が等しい場合は id 昇順 (Req 9.4)
 *   - topFactorId は factors[0].id と一致 (Req 9.5)
 *   - computedAt を除き、同一入力に対し常に同一出力 (Req 9.2・決定的・副作用なし)
 *
 * @param answers    q1..q20 の回答
 * @param weightTable 質問ごとの要因重み定義
 * @param factorMeta 要因メタ情報 (この集合が結果の要因集合を定める)
 */
export function diagnose(
  answers: DiagnosisAnswers,
  weightTable: QuestionWeight[],
  factorMeta: FactorMeta[]
): DiagnosisResult {
  const raw: Record<string, number> = {}; // 要因ごとの素点
  const maxRaw: Record<string, number> = {}; // 要因ごとの最大可能点

  for (const meta of factorMeta) {
    raw[meta.id] = 0;
    maxRaw[meta.id] = 0;
  }

  // ループ不変条件: 処理済み質問までの raw[f] は、その質問群に対する
  // 重み付き合計を正しく表す。
  for (const qw of weightTable) {
    const choice = toChoiceNumber(answers[qw.questionId]); // 0..4
    for (const [factorId, weight] of Object.entries(qw.weights)) {
      // factorMeta に存在しない要因の重みは無視する (結果集合を factorMeta に限定)。
      if (!(factorId in raw)) continue;
      raw[factorId] += choice * weight;
      maxRaw[factorId] += 4 * Math.max(0, weight); // 最大寄与 (負の重みは下限0側)
    }
  }

  const factors: Factor[] = factorMeta.map((meta) => {
    const denom = maxRaw[meta.id] || 1; // 0 除算回避
    const normalized = clamp(
      Math.round((raw[meta.id] / denom) * 100),
      SCORE_MIN,
      SCORE_MAX
    );
    return {
      id: meta.id,
      label: meta.label,
      score: normalized,
      description: meta.description,
      relatedFactorIds: meta.relatedFactorIds,
    };
  });

  // score 降順。score が等しい場合は id 昇順 (Req 9.4)。
  factors.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    factors,
    topFactorId: factors[0].id,
    computedAt: new Date().toISOString(),
  };
}

/**
 * 回答値 ("0".."4") を数値 (0..4) へ変換する。
 * 不正値は 0 として扱う (diagnose は有効な answers を前提とするが安全側に倒す)。
 */
function toChoiceNumber(choice: ChoiceValue | undefined): number {
  const n = Number(choice);
  return Number.isFinite(n) ? n : 0;
}
