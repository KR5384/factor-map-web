import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FACTOR_ORDER,
  categoryIdOfFactor,
  isFactorOrderValid,
  toDiagnosisResult,
  toResultDisplay,
} from "@/api/resultMapping";
import type { FactorAnalysisResponse, RankedCategory } from "@/api/apiClient";
import type { FactorMeta } from "@/engine/diagnose";

const questions = JSON.parse(readFileSync("public/questions.json", "utf-8")) as { factorMeta: FactorMeta[] };
const factorMeta = questions.factorMeta;

/** [分類ID, 点数] の並び → 順位つきの分類 */
const ranked = (items: [number, number][]): RankedCategory[] =>
  items.map(([category_id, score], i) => ({ rank: i + 1, category_id, score }));

function response(
  scores: number[],
  main: number | null,
  extra: Partial<FactorAnalysisResponse> = {}
): FactorAnalysisResponse {
  return {
    diagnosis_id: "d-1",
    scoring_version: "2026-11-20-v2",
    scores: scores.map((score, i) => ({ category_id: i + 1, score })),
    circles: [],
    type_categories: [],
    main_category_id: main,
    result_type_id: null,
    low_moyamoya: false,
    links: [],
    ...extra,
  };
}

/** 依頼書 (2026-11-20) のレスポンス例: 円5つ、タイプは 3 と 9 の2つ */
const example = response([45, 30, 82, 20, 10, 66, 15, 25, 74, 68], 3, {
  circles: ranked([[3, 82], [9, 74], [10, 68], [6, 66], [1, 45]]),
  type_categories: ranked([[3, 82], [9, 74]]),
  result_type_id: "03-09",
  links: [{ from: 3, to: 9 }],
});

const ids = (factors: { id: string }[]) => factors.map((f) => f.id);

describe("questions.json の factorMeta", () => {
  it("分類ID 1〜10 の順に並んでいる (バックエンドと同じ順)", () => {
    expect(factorMeta.map((m) => m.id)).toEqual([...FACTOR_ORDER]);
    expect(isFactorOrderValid(factorMeta)).toBe(true);
  });

  it("要因ID → 分類ID", () => {
    expect(categoryIdOfFactor("time_margin")).toBe(1);
    expect(categoryIdOfFactor("indecision")).toBe(10);
    expect(categoryIdOfFactor("unknown")).toBeUndefined();
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

  it("全部0点 (main が null) のときは 1位を最大要因にする", () => {
    const res = response(Array(10).fill(0), null);
    expect(toDiagnosisResult(res, factorMeta).topFactorId).toBe("time_margin");
  });

  it("並びの違う factorMeta は受け付けない", () => {
    const swapped = [factorMeta[1], factorMeta[0], ...factorMeta.slice(2)];
    expect(() => toDiagnosisResult(response(Array(10).fill(0), 1), swapped)).toThrow();
  });
});

describe("toResultDisplay", () => {
  const display = (res: FactorAnalysisResponse) =>
    toResultDisplay(res, toDiagnosisResult(res, factorMeta), factorMeta);

  it("円・タイプ・線を API の並びのまま要因に置き換える", () => {
    const d = display(example);
    expect(ids(d.circles)).toEqual([
      "info_overload",
      "rumination",
      "indecision",
      "future_uncertainty",
      "time_margin",
    ]);
    expect(d.circles.map((f) => f.score)).toEqual([82, 74, 68, 66, 45]);
    expect(ids(d.typeFactors)).toEqual(["info_overload", "rumination"]);
    expect(d.typeId).toBe("03-09");
    expect(d.lines).toEqual([{ from: "info_overload", to: "rumination" }]);
    expect(d.lowMoyamoya).toBe(false);
  });

  it("並べ替え・絞り込みはしない (API の並びをそのまま使う)", () => {
    const res = { ...example, circles: [...example.circles].reverse() };
    expect(ids(display(res).circles)[0]).toBe("time_margin");
  });

  it("3つのタイプなら線は3本", () => {
    const res = response([10, 10, 80, 10, 75, 10, 10, 10, 72, 10], 3, {
      circles: ranked([[3, 80], [5, 75], [9, 72]]),
      type_categories: ranked([[3, 80], [5, 75], [9, 72]]),
      result_type_id: "03-05-09",
      links: [
        { from: 3, to: 5 },
        { from: 3, to: 9 },
        { from: 5, to: 9 },
      ],
    });
    expect(display(res).lines).toHaveLength(3);
  });

  it("もやもやが少ない人は、タイプ1つ・線なし", () => {
    const res = response([10, 40, 0, 0, 0, 0, 0, 0, 0, 0], 2, {
      circles: ranked([[2, 40]]),
      type_categories: ranked([[2, 40]]),
      result_type_id: "02",
      low_moyamoya: true,
    });
    const d = display(res);
    expect(d.lowMoyamoya).toBe(true);
    expect(d.typeId).toBe("02");
    expect(ids(d.typeFactors)).toEqual(["recovery"]);
    expect(d.lines).toEqual([]);
  });

  it("全部0点は、タイプも円も無し", () => {
    const d = display(response(Array(10).fill(0), null, { low_moyamoya: true }));
    expect(d.circles).toEqual([]);
    expect(d.typeFactors).toEqual([]);
    expect(d.typeId).toBeNull();
  });
});
