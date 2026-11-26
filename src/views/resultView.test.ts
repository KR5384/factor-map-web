import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOW_MOYAMOYA_MESSAGE,
  NO_MOYAMOYA_MESSAGE,
  createResultView,
} from "@/views/resultView";
import { createMapRenderer } from "@/views/mapRenderer";
import { parseTypeCatalog } from "@/engine/typeCatalog";
import type { ApiClient, FactorAnalysisResponse, RankedCategory } from "@/api/apiClient";
import type { DiagnosisStore } from "@/store/diagnosisStore";
import type { FactorMeta } from "@/engine/diagnose";

const factorMeta = (
  JSON.parse(readFileSync("public/questions.json", "utf-8")) as { factorMeta: FactorMeta[] }
).factorMeta;
const typeCatalog = parseTypeCatalog(JSON.parse(readFileSync("public/types.json", "utf-8")));

const ranked = (items: [number, number][]): RankedCategory[] =>
  items.map(([category_id, score], i) => ({ rank: i + 1, category_id, score }));

function response(scores: number[], extra: Partial<FactorAnalysisResponse>): FactorAnalysisResponse {
  return {
    diagnosis_id: "d-1",
    scoring_version: "2026-11-20-v2",
    scores: scores.map((score, i) => ({ category_id: i + 1, score })),
    circles: [],
    type_categories: [],
    main_category_id: null,
    result_type_id: null,
    low_moyamoya: false,
    links: [],
    ...extra,
  };
}

/** API-02 が data を返す前提で結果画面を描く。 */
async function render(data: FactorAnalysisResponse): Promise<HTMLElement> {
  const container = document.createElement("div");
  const store = { snapshot: () => ({}), getSessionId: () => "s-1" } as unknown as DiagnosisStore;
  const apiClient = {
    postDiagnosis: async () => ({ ok: true, data }),
  } as unknown as ApiClient;
  const view = createResultView(container, {
    store,
    factorMeta,
    typeCatalog,
    apiClient,
    mapRenderer: createMapRenderer(),
    getDiagnosisId: () => "d-1",
    navigateToPostSurvey: () => {},
    navigateToTop: () => {},
  });
  await view.enter();
  return container;
}

const text = (root: HTMLElement, selector: string) => root.querySelector(selector)?.textContent ?? null;

beforeEach(() => localStorage.clear());

describe("結果画面", () => {
  it("円5つ・タイプの円だけ色を変える・タイプどうしに線1本・タイプ名とひとこと解説", async () => {
    const root = await render(
      response([45, 30, 82, 20, 10, 66, 15, 25, 74, 68], {
        circles: ranked([[3, 82], [9, 74], [10, 68], [6, 66], [1, 45]]),
        type_categories: ranked([[3, 82], [9, 74]]),
        main_category_id: 3,
        result_type_id: "03-09",
        links: [{ from: 3, to: 9 }],
      })
    );

    expect(root.querySelectorAll(".bubble")).toHaveLength(5);
    expect(
      [...root.querySelectorAll(".bubble--type")].map((g) => (g as SVGGElement).dataset.factorId)
    ).toEqual(["info_overload", "rumination"]);
    expect(root.querySelectorAll(".map-link")).toHaveLength(1);

    const entry = typeCatalog.get("03-09")!;
    expect(text(root, ".result-view__headline-lead")).toBe("2つの組み合わせ");
    expect(text(root, ".result-view__headline-name")).toBe(entry.name);
    expect(text(root, ".result-view__headline-desc")).toBe(entry.description);
    // 円には「/」より前の短いラベルと点数を出す。
    const top = root.querySelector('.bubble[data-factor-id="info_overload"]')!;
    expect(top.querySelector(".bubble__label")?.textContent).toBe("情報過多");
    expect(top.querySelector(".bubble__score")?.textContent).toBe("82");
    expect(root.querySelectorAll(".factor-details > li")).toHaveLength(5);
    // 画面の主見出しは h1。タイプの要因には文字の印も付ける (色だけに頼らない)。
    expect(text(root, "h1")).toBe("診断結果");
    expect(root.querySelectorAll(".factor__type-tag")).toHaveLength(2);
    // オレンジ (タイプの要因) の説明は開いたまま、ほかは畳んで「開く」で見せる。
    const body = (id: string) => root.querySelector<HTMLElement>(`#factor-body-${id}`)!;
    expect(body("info_overload").hidden).toBe(false);
    expect(body("rumination").hidden).toBe(false);
    const toggles = root.querySelectorAll<HTMLButtonElement>(".factor__toggle");
    expect(toggles).toHaveLength(3);
    const toggle = toggles[0]!;
    const closedBody = root.querySelector<HTMLElement>(`#${toggle.getAttribute("aria-controls")}`)!;
    expect(closedBody.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("開く");
    toggle.click();
    expect(closedBody.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("閉じる");
    expect(root.querySelector(".moyamoya-map")?.getAttribute("aria-label")).toContain(
      "タイプを決めた要因は 情報過多/認知負荷、反すう/考え続ける状態。"
    );
    // 要因詳細の見出しは「表示名（タイプ名）」。括弧を二重にしない。
    const heading = root.querySelector('.factor[data-factor-id="info_overload"] .factor__label')!;
    expect(heading.firstChild?.textContent).toBe(
      `情報過多/認知負荷（${typeCatalog.get("03")!.name}）`
    );
    expect(root.querySelector(".result-view__low")).toBeNull();
  });

  it("3つのタイプは線3本、「3つの組み合わせ」とタイプ名", async () => {
    const root = await render(
      response([10, 10, 80, 10, 75, 10, 10, 10, 72, 10], {
        circles: ranked([[3, 80], [5, 75], [9, 72]]),
        type_categories: ranked([[3, 80], [5, 75], [9, 72]]),
        main_category_id: 3,
        result_type_id: "03-05-09",
        links: [
          { from: 3, to: 5 },
          { from: 3, to: 9 },
          { from: 5, to: 9 },
        ],
      })
    );
    expect(root.querySelectorAll(".map-link")).toHaveLength(3);
    expect(text(root, ".result-view__headline-lead")).toBe("3つの組み合わせ");
    expect(text(root, ".result-view__headline-name")).toBe(typeCatalog.get("03-05-09")!.name);
  });

  it("もやもやが少ない人は「もやもやは少なめです」とタイプ1つ、線なし", async () => {
    const root = await render(
      response([10, 40, 0, 0, 0, 0, 0, 0, 0, 0], {
        circles: ranked([[2, 40]]),
        type_categories: ranked([[2, 40]]),
        main_category_id: 2,
        result_type_id: "02",
        low_moyamoya: true,
      })
    );
    expect(text(root, ".result-view__low")).toBe(LOW_MOYAMOYA_MESSAGE);
    expect(text(root, ".result-view__headline-name")).toBe(typeCatalog.get("02")!.name);
    expect(root.querySelectorAll(".map-link")).toHaveLength(0);
  });

  it("全部0点は、タイプも円も出さず、その旨の文と事後アンケートへの導線だけ", async () => {
    const root = await render(response(Array(10).fill(0), { low_moyamoya: true }));
    expect(text(root, ".result-view__none")).toBe(NO_MOYAMOYA_MESSAGE);
    expect(root.querySelector(".result-view__headline")).toBeNull();
    expect(root.querySelector(".bubble")).toBeNull();
    expect(root.querySelector(".factor-details")).toBeNull();
    expect(root.querySelector(".result-view__next")).not.toBeNull();
  });
});
