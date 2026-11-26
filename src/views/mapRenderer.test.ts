import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computeLayout,
  computeLinkSegments,
  shortLabel,
  splitLabel,
  fitLabel,
  textWidthEm,
  BUBBLE_RADIUS_MIN,
  BUBBLE_RADIUS_MAX,
  type MapLine,
} from "@/views/mapRenderer";
import type { Factor } from "@/models/types";

const factor = (id: string, score: number): Factor =>
  ({ id, label: id, score, description: "", relatedFactorIds: [] }) as unknown as Factor;

/** 点と線分の距離。 */
function distToSegment(px: number, py: number, s: { x1: number; y1: number; x2: number; y2: number }) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

describe("shortLabel", () => {
  it("「/」より前を使い、無ければそのまま", () => {
    expect(shortLabel("反すう/考え続ける状態")).toBe("反すう");
    expect(shortLabel("時間・余白不足")).toBe("時間・余白不足");
  });
});

describe("fitLabel (円からはみ出さない)", () => {
  const labels = [
    "時間・余白不足", "回復不足", "情報過多", "他者比較", "孤独",
    "将来の不確実性", "コントロール感の低下", "理想と現実のギャップ", "反すう", "決められない",
  ];

  it("長いラベルは区切りのよい所で2行に分ける", () => {
    expect(splitLabel("理想と現実のギャップ", 0)).toEqual(["理想と現実の", "ギャップ"]);
    expect(splitLabel("コントロール感の低下", 0)).toEqual(["コントロール", "感の低下"]);
    expect(splitLabel("反すう", 10)).toEqual(["反すう"]);
  });

  it("どのラベルも、最小〜最大のどの円でも横幅に収まる", () => {
    for (const label of labels) {
      for (let r = BUBBLE_RADIUS_MIN; r <= BUBBLE_RADIUS_MAX; r += 1) {
        const { lines, fontSize } = fitLabel(label, r);
        // 2行目の下端 (中心から約 +4px) と1行目の上端 (約 -24px) のうち狭い方の幅
        const chord = 2 * Math.sqrt(r * r - 24 * 24);
        for (const line of lines) expect(textWidthEm(line) * fontSize).toBeLessThanOrEqual(chord);
      }
    }
  });
});

describe("computeLayout", () => {
  it("円は重ならず、枠に収まり、タイプ以外の円は線の上に乗らない", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 3 }),
        (scores, typeCount) => {
          const factors = scores.map((s, i) => factor(`f${i}`, s));
          const typeIds = factors.slice(0, Math.min(typeCount, factors.length)).map((f) => f.id);
          const links: MapLine[] = [];
          for (let i = 0; i < typeIds.length; i++)
            for (let j = i + 1; j < typeIds.length; j++) links.push({ from: typeIds[i]!, to: typeIds[j]! });

          const layout = computeLayout(factors, { clusterIds: typeIds, links });
          expect(layout.bubbles).toHaveLength(factors.length);

          for (const [i, a] of layout.bubbles.entries()) {
            expect(a.cx - a.radius).toBeGreaterThanOrEqual(0);
            expect(a.cy - a.radius).toBeGreaterThanOrEqual(0);
            expect(a.cx + a.radius).toBeLessThanOrEqual(layout.width);
            expect(a.cy + a.radius).toBeLessThanOrEqual(layout.height);
            for (const b of layout.bubbles.slice(i + 1)) {
              expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThan(a.radius + b.radius);
            }
          }

          const segments = computeLinkSegments(layout.bubbles, links);
          expect(segments).toHaveLength(links.length);
          for (const b of layout.bubbles) {
            if (typeIds.includes(b.factor.id)) continue;
            for (const s of segments) expect(distToSegment(b.cx, b.cy, s)).toBeGreaterThan(b.radius);
          }
        }
      )
    );
  });

  it("同じ入力からは同じ配置になる", () => {
    const factors = [factor("a", 95), factor("b", 93), factor("c", 90), factor("d", 84), factor("e", 60)];
    const opts = { clusterIds: ["a", "b", "c"], links: [{ from: "a", to: "b" }] };
    expect(computeLayout(factors, opts)).toEqual(computeLayout(factors, opts));
  });
});
