/**
 * API-02 の採点結果 (分類ID 1〜10) を、画面で使う DiagnosisResult (要因ID: "time_margin" など) に変える。
 *
 * 分類ID と要因ID の対応は questions.json の factorMeta の並び順 (1番目 = 分類ID 1)。
 * バックエンド (factor-map-api の scoring.py FACTOR_IDS) と同じ順であることを FACTOR_ORDER で確かめる。
 */

import type { FactorMeta } from "@/engine/diagnose";
import type { DiagnosisResult, Factor } from "@/models/types";
import type { FactorAnalysisResponse } from "@/api/apiClient";
import { singleTypeName } from "@/engine/typeCatalog";

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

export function toDiagnosisResult(res: FactorAnalysisResponse, factorMeta: FactorMeta[]): DiagnosisResult {
  if (!isFactorOrderValid(factorMeta)) {
    throw new Error("questions.json の factorMeta の並びが分類IDの順と違います");
  }
  const metaOf = (categoryId: number): FactorMeta => factorMeta[categoryId - 1];

  // 点数の高い順、同点は分類IDの小さい順 (バックエンドの順位と同じ)
  const ordered = [...res.scores].sort((a, b) => b.score - a.score || a.category_id - b.category_id);
  const factors: Factor[] = ordered.map((s) => {
    const meta = metaOf(s.category_id);
    // 単独タイプ名は moyamoya_175types.csv が正。
    const typeName = singleTypeName(meta.id);
    return {
      id: meta.id,
      label: meta.label,
      ...(typeName !== undefined ? { typeName } : {}),
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
