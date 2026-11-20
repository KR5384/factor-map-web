import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allTypeIds,
  categoryIdsOf,
  parseTypeCatalog,
  typeDisplayName,
  typeIdOf,
} from "@/engine/typeCatalog";

const typesJson = JSON.parse(readFileSync("public/types.json", "utf-8")) as Record<string, unknown>;

describe("タイプID", () => {
  it("分類IDを小さい順に2桁でつなぐ (API の result_type_id と同じ形)", () => {
    expect(typeIdOf([5])).toBe("05");
    expect(typeIdOf([9, 3])).toBe("03-09");
    expect(typeIdOf([9, 5, 3])).toBe("03-05-09");
    expect(categoryIdsOf("03-05-09")).toEqual([3, 5, 9]);
  });

  it("全部で 175件 (1つ10・2つ45・3つ120)、重複なし", () => {
    const ids = allTypeIds();
    expect(ids).toHaveLength(175);
    expect(new Set(ids).size).toBe(175);
    const bySize = [1, 2, 3].map((n) => ids.filter((id) => categoryIdsOf(id).length === n).length);
    expect(bySize).toEqual([10, 45, 120]);
  });
});

describe("public/types.json", () => {
  it("175件がそろっていて、すべてにタイプ名がある", () => {
    const catalog = parseTypeCatalog(typesJson);
    expect(catalog.size).toBe(175);
    expect(catalog.get("01")?.name).toBe("余白ゼロの綱渡り");
    expect(catalog.get("01-02")?.name).toBe("完全燃焼・すり減り");
  });
});

describe("parseTypeCatalog", () => {
  it("足りないタイプID があれば例外にする", () => {
    const { "03-09": _removed, ...rest } = typesJson;
    expect(() => parseTypeCatalog(rest)).toThrow(/03-09/);
  });

  it("タイプ名が空・余計なIDがあれば例外にする", () => {
    expect(() => parseTypeCatalog({ ...typesJson, "05": { name: "", description: "" } })).toThrow(/05/);
    expect(() => parseTypeCatalog({ ...typesJson, "11": { name: "x", description: "" } })).toThrow(/11/);
  });
});

describe("typeDisplayName", () => {
  it("1つ・2つは『名前』タイプ、3つは『名前』", () => {
    const entry = { name: "名前", description: "" };
    expect(typeDisplayName("05", entry)).toBe("『名前』タイプ");
    expect(typeDisplayName("03-09", entry)).toBe("『名前』タイプ");
    expect(typeDisplayName("03-05-09", entry)).toBe("『名前』");
  });
});
