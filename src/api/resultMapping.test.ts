import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FACTOR_ORDER, isFactorOrderValid, toDiagnosisResult } from "@/api/resultMapping";
import type { FactorAnalysisResponse } from "@/api/apiClient";
import type { FactorMeta } from "@/engine/diagnose";

const questions = JSON.parse(readFileSync("public/questions.json", "utf-8")) as { factorMeta: FactorMeta[] };
const factorMeta = questions.factorMeta;

function response(scores: number[], main: number | null, low = false): FactorAnalysisResponse {
  return {
    diagnosis_id: "d-1",
    scoring_version: "v",
    scores: scores.map((score, i) => ({ category_id: i + 1, score })),
    shown: [],
    main_category_id: main,
    result_type_id: main ? `T${String(main).padStart(2, "0")}` : null,
    low_moyamoya: low,
    links: [],
  };
}

describe("questions.json の factorMeta", () => {
  it("分類ID 1〜10 の順に並んでいる (バックエンドと同じ順)", () => {
    expect(factorMeta.map((m) => m.id)).toEqual([...FACTOR_ORDER]);
    expect(isFactorOrderValid(factorMeta)).toBe(true);
  });
});

describe("toDiagnosisResult", () => {
  it("分類ID を要因ID に変え、点数の高い順に並べる", () => {
    const res = response([50, 50, 50, 55, 70, 68, 50, 55, 50, 50], 5);
    const result = toDiagnosisResult(res, factorMeta);
    expect(result.topFactorId).toBe("loneliness");
    expect(result.factors.map((f) => [f.id, f.score]).slice(0, 4)).toEqual([
      ["loneliness", 70],
      ["future_uncertainty", 68],
      ["comparison", 55],
      ["ideal_gap", 55],
    ]);
    expect(result.factors[0].label).toBe("孤独/つながり不足");
  });

  it("もやもやが少ない (main が null) ときは 1位を最大要因にする", () => {
    const res = response([10, 20, 0, 0, 0, 0, 0, 0, 0, 0], null, true);
    expect(toDiagnosisResult(res, factorMeta).topFactorId).toBe("recovery");
  });

  it("並びの違う factorMeta は受け付けない", () => {
    const swapped = [factorMeta[1], factorMeta[0], ...factorMeta.slice(2)];
    expect(() => toDiagnosisResult(response(Array(10).fill(0), 1), swapped)).toThrow();
  });
});
