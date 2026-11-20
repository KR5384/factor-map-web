import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FACTOR_ORDER,
  buildCatalogs,
  classifyType,
  parseTypeCsv,
  singleTypeName,
  typeKey,
} from "@/engine/typeCatalog";
import type { Factor } from "@/models/types";

const csv = readFileSync("src/data/moyamoya_175types.csv", "utf-8");
const ids = FACTOR_ORDER.map((f) => f.id);

/** n 個から k 個選ぶ組み合わせ (固定順)。 */
function combinations(k: number, from = 0): string[][] {
  if (k === 0) return [[]];
  const out: string[][] = [];
  for (let i = from; i < ids.length; i++) {
    for (const rest of combinations(k - 1, i + 1)) out.push([ids[i], ...rest]);
  }
  return out;
}

const factor = (id: string, score: number): Factor => ({
  id,
  label: id,
  score,
  description: "",
  relatedFactorIds: [],
});

describe("moyamoya_175types.csv", () => {
  const catalogs = buildCatalogs(parseTypeCsv(csv));

  it("単独10・2複合45・3複合120 の 175 件がある", () => {
    expect(catalogs.single.size).toBe(10);
    expect(catalogs.pair.size).toBe(45);
    expect(catalogs.triple.size).toBe(120);
  });

  it("すべての組み合わせにタイプが定義されている", () => {
    for (const [k, catalog] of [
      [1, catalogs.single],
      [2, catalogs.pair],
      [3, catalogs.triple],
    ] as const) {
      for (const combo of combinations(k)) {
        expect(catalog.has(typeKey(combo)), combo.join("|")).toBe(true);
      }
    }
  });

  it("単独タイプ名を CSV から引ける", () => {
    expect(singleTypeName("time_margin", catalogs)).toBe("余白ゼロの綱渡り");
  });

  it("表示要因の数でタイプを判定する", () => {
    expect(classifyType([factor("recovery", 90)], catalogs)?.displayName).toBe(
      "『充電が追いつかない』タイプ"
    );
    expect(
      classifyType([factor("recovery", 90), factor("time_margin", 80)], catalogs)?.displayName
    ).toBe("『完全燃焼・すり減り』タイプ");
    expect(
      classifyType(
        [factor("info_overload", 90), factor("recovery", 85), factor("time_margin", 80)],
        catalogs
      )?.displayName
    ).toBe("『満員御礼パンクさん』");
  });
});

describe("parseTypeCsv", () => {
  const head = "No,要因数,要因1,要因2,要因3,タイプ名,解説,出典\n";

  it("要因数と要因列が合わない行は例外にする", () => {
    expect(() => parseTypeCsv(head + "1,1,回復不足,時間・余白不足,,X,,\n")).toThrow();
    expect(() => parseTypeCsv(head + "1,2,回復不足,,,X,,\n")).toThrow();
  });

  it("未知の要因名は例外にする", () => {
    expect(() => parseTypeCsv(head + "1,1,存在しない要因,,,X,,\n")).toThrow();
  });
});
