import { describe, expect, it } from "vitest";
import { toggleCause, validatePostSurvey, validatePreSurvey } from "@/store/surveyStore";

describe("validatePreSurvey", () => {
  const ok = { frequency: 2, explain: 3, relation: 1, causes: [3, 9] };

  it("すべて回答していれば空", () => {
    expect(validatePreSurvey(ok)).toEqual([]);
    expect(validatePreSurvey({ ...ok, ageGroup: "30s" })).toEqual([]);
  });

  it("未回答・範囲外の項目を返す", () => {
    expect(validatePreSurvey({ causes: [] })).toEqual(["frequency", "explain", "relation", "causes"]);
    expect(validatePreSurvey({ ...ok, frequency: 5 })).toEqual(["frequency"]);
    expect(validatePreSurvey({ ...ok, explain: 6 })).toEqual(["explain"]);
    expect(validatePreSurvey({ ...ok, ageGroup: "60s" })).toEqual(["ageGroup"]);
  });

  it("98・99 はほかと同時に選べない", () => {
    expect(validatePreSurvey({ ...ok, causes: [99] })).toEqual([]);
    expect(validatePreSurvey({ ...ok, causes: [98, 3] })).toEqual(["causes"]);
    expect(validatePreSurvey({ ...ok, causes: [11] })).toEqual(["causes"]);
  });
});

describe("validatePostSurvey", () => {
  it("A群は A1〜A4 が必須", () => {
    expect(validatePostSurvey({ explain: 4, relation: 4 }, "A")).toEqual(["fit", "discovery"]);
    expect(validatePostSurvey({ explain: 4, relation: 4, fit: 5, discovery: 3 }, "A")).toEqual([]);
  });

  it("B群は A3・A4 を聞かない", () => {
    expect(validatePostSurvey({ explain: 4, relation: 4 }, "B")).toEqual([]);
  });

  it("感想は200文字まで (前後の空白は数えない)", () => {
    const base = { explain: 4, relation: 4, fit: 5, discovery: 3 };
    expect(validatePostSurvey({ ...base, comment: ` ${"あ".repeat(200)} ` }, "A")).toEqual([]);
    expect(validatePostSurvey({ ...base, comment: "あ".repeat(201) }, "A")).toEqual(["comment"]);
  });
});

describe("toggleCause", () => {
  it("分類は複数選べて、番号順に並ぶ", () => {
    expect(toggleCause([9], 3, true)).toEqual([3, 9]);
    expect(toggleCause([3, 9], 3, false)).toEqual([9]);
  });

  it("98・99 を選ぶとほかは外れ、ほかを選ぶと 98・99 は外れる", () => {
    expect(toggleCause([3, 9], 99, true)).toEqual([99]);
    expect(toggleCause([99], 98, true)).toEqual([98]);
    expect(toggleCause([98], 5, true)).toEqual([5]);
  });
});
