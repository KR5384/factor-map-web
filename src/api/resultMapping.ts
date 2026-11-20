/**
 * API-02 の採点結果 (分類ID 1〜10) を、画面で使う形 (要因ID: "time_margin" など) に変える。
 *
 * 分類ID と要因ID の対応は questions.json の factorMeta の並び順 (1番目 = 分類ID 1)。
 * バックエンド (factor-map-api の scoring.py FACTOR_IDS) と同じ順であることを FACTOR_ORDER で確かめる。
 *
 * 円・タイプ・線はバックエンドが決める (2026-11-20 決定の表示ルール)。ここでは分類ID を要因に
 * 置き換えるだけで、並べ替えや絞り込みはしない。
 */

import type { FactorMeta } from "@/engine/diagnose";
import type { DiagnosisResult, Factor } from "@/models/types";
import type { FactorAnalysisResponse, RankedCategory } from "@/api/apiClient";

/** 分類ID 1〜10 の順の要因ID (バックエンドと共通) */
export const FACTOR_ORDER = [
  "time_margin",
  "recovery",
  "info_overload",
  "comparison",
  "loneliness",
  "future_uncertainty",
  "control",
  "ideal_gap",
  "rumination",
  "indecision",
] as const;

/** factorMeta が分類IDの順に並んでいるか */
export function isFactorOrderValid(factorMeta: FactorMeta[]): boolean {
  return (
    factorMeta.length === FACTOR_ORDER.length &&
    factorMeta.every((m, i) => m.id === FACTOR_ORDER[i])
  );
}

/** 要因ID → 分類ID (1〜10)。未知なら undefined。 */
export function categoryIdOfFactor(factorId: string): number | undefined {
  const i = (FACTOR_ORDER as readonly string[]).indexOf(factorId);
  return i >= 0 ? i + 1 : undefined;
}

/** scores (10分類すべての点数) を、点数の高い順 (同点は分類IDの小さい順) の DiagnosisResult にする。 */
export function toDiagnosisResult(res: FactorAnalysisResponse, factorMeta: FactorMeta[]): DiagnosisResult {
  if (!isFactorOrderValid(factorMeta)) {
    throw new Error("questions.json の factorMeta の並びが分類IDの順と違います");
  }
  const metaOf = (categoryId: number): FactorMeta => factorMeta[categoryId - 1];

  // 点数の高い順、同点は分類IDの小さい順 (バックエンドの順位と同じ)
  const ordered = [...res.scores].sort((a, b) => b.score - a.score || a.category_id - b.category_id);
  const factors: Factor[] = ordered.map((s) => {
    const meta = metaOf(s.category_id);
    return {
      id: meta.id,
      label: meta.label,
      score: s.score,
      description: meta.description,
      relatedFactorIds: meta.relatedFactorIds,
    };
  });

  const topCategory = res.main_category_id ?? ordered[0].category_id;
  return {
    factors,
    topFactorId: metaOf(topCategory).id,
    computedAt: new Date().toISOString(),
  };
}

/** 線 1 本 (タイプの要因どうし)。向きは無い。 */
export interface FactorLine {
  from: string;
  to: string;
}

/** 結果画面に出すもの (バックエンドが決めたもの)。 */
export interface ResultDisplay {
  /** 円に出す要因 (API の並び = 順位順、0〜5件) */
  circles: Factor[];
  /** タイプの要因 (API の並び = 順位順、0〜3件) */
  typeFactors: Factor[];
  /** タイプID ("05" / "03-09" / "03-05-09")。全部0点のときは null */
  typeId: string | null;
  /** タイプの要因どうしを結ぶ線 (2つなら1本、3つなら3本) */
  lines: FactorLine[];
  /** 1位でも50点未満 (もやもやが少ない人)。タイプは1つ返る */
  lowMoyamoya: boolean;
}

/**
 * toResultDisplay: API-02 の circles / type_categories / links を、要因に置き換えて返す。
 * API の並びをそのまま使う (並べ替え・絞り込みはしない)。
 *
 * @param res    API-02 のレスポンス
 * @param result toDiagnosisResult で変換した結果 (全10要因。点数・説明文を引くのに使う)
 */
export function toResultDisplay(
  res: FactorAnalysisResponse,
  result: DiagnosisResult,
  factorMeta: FactorMeta[]
): ResultDisplay {
  const byId = new Map(result.factors.map((f) => [f.id, f]));
  const factorOf = (categoryId: number): Factor | undefined =>
    byId.get(factorMeta[categoryId - 1]?.id ?? "");
  const pick = (items: readonly RankedCategory[]): Factor[] =>
    items.map((s) => factorOf(s.category_id)).filter((f): f is Factor => f !== undefined);

  const lines: FactorLine[] = [];
  for (const l of res.links) {
    const from = factorOf(l.from);
    const to = factorOf(l.to);
    if (from && to) lines.push({ from: from.id, to: to.id });
  }

  return {
    circles: pick(res.circles),
    typeFactors: pick(res.type_categories),
    typeId: res.result_type_id,
    lines,
    lowMoyamoya: res.low_moyamoya,
  };
}
