/**
 * アクセシビリティ対応のテスト (フォーカスの移動・エラー文・代替テキスト)。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createRadioGroup, focusFirstInvalid, highlightFields } from "@/views/surveyFields";
import { createQuestionsView, type QuestionDef } from "@/views/questionsView";
import { createDiagnosisStore } from "@/store/diagnosisStore";
import { describeMap } from "@/views/mapRenderer";
import { focusViewHeading } from "@/views/a11y";
import type { Factor, QuestionId } from "@/models/types";

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe("focusViewHeading", () => {
  it("h1 にフォーカスを移す (Tab 順には入れない)", () => {
    const c = document.createElement("div");
    c.innerHTML = "<section><h1>見出し</h1><button>ボタン</button></section>";
    document.body.appendChild(c);
    expect(focusViewHeading(c)).toBe(true);
    expect(document.activeElement?.tagName).toBe("H1");
    expect((document.activeElement as HTMLElement).tabIndex).toBe(-1);
  });
});

describe("アンケートの未回答表示", () => {
  it("色だけでなく文で示し、項目に結び付け、最初の入力欄へフォーカスする。答えると消える", () => {
    const form = document.createElement("form");
    const group = createRadioGroup({
      field: "explain",
      legend: "説明できる",
      name: "explain",
      options: [
        { value: 1, label: "はい" },
        { value: 2, label: "いいえ" },
      ],
      onSelect: () => {},
    });
    form.appendChild(group);
    document.body.appendChild(form);

    highlightFields(form, ["explain"]);
    const message = group.querySelector(".survey__field-error");
    expect(message?.textContent).toBe("1つ選んでください");
    expect(group.getAttribute("aria-describedby")).toBe(message?.id);
    expect(group.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");

    focusFirstInvalid(form);
    expect(document.activeElement).toBe(group.querySelector("input"));

    const input = group.querySelector("input")!;
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(group.querySelector(".survey__field-error")).toBeNull();
    expect(group.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("質問画面のフォーカス", () => {
  const questions: QuestionDef[] = Array.from({ length: 20 }, (_, i) => ({
    id: `q${i + 1}` as QuestionId,
    text: `質問${i + 1}`,
    choices: ["a", "b", "c", "d", "e"],
  }));

  function setup() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const store = createDiagnosisStore({ sessionId: "s-1" });
    const view = createQuestionsView({ container, store, questions, onNavigateToResult: () => {} });
    view.render();
    return container;
  }

  it("選択肢を選んでも、その選択肢にフォーカスが残る", () => {
    const c = setup();
    c.querySelector<HTMLButtonElement>('.questions-view__choice[data-value="2"]')!.click();
    const active = document.activeElement as HTMLElement;
    expect(active.dataset.value).toBe("2");
    expect(active.getAttribute("aria-pressed")).toBe("true");
  });

  it("次へで、新しい設問文 (h1) にフォーカスが移る", () => {
    const c = setup();
    c.querySelector<HTMLButtonElement>('.questions-view__choice[data-value="2"]')!.click();
    c.querySelector<HTMLButtonElement>(".questions-view__next")!.click();
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.textContent).toContain("質問2");
  });

  it("答えるまで「次へ」は押せず、理由の案内が出る", () => {
    const c = setup();
    expect(c.querySelector<HTMLButtonElement>(".questions-view__next")!.disabled).toBe(true);
    expect(c.querySelector(".questions-view__hint")?.textContent).toContain("次へ");
    c.querySelector<HTMLButtonElement>('.questions-view__choice[data-value="2"]')!.click();
    expect(c.querySelector<HTMLButtonElement>(".questions-view__next")!.disabled).toBe(false);
    expect(c.querySelector(".questions-view__hint")).toBeNull();
  });

  it("「診断する」は最後の質問でだけ出る", () => {
    const c = setup();
    expect(c.querySelector(".questions-view__diagnose")).toBeNull();
    for (let i = 0; i < 19; i++) {
      c.querySelector<HTMLButtonElement>('.questions-view__choice[data-value="2"]')!.click();
      c.querySelector<HTMLButtonElement>(".questions-view__next")!.click();
    }
    expect(c.querySelector(".questions-view__next")).toBeNull();
    expect(c.querySelector<HTMLButtonElement>(".questions-view__diagnose")!.disabled).toBe(true);
    c.querySelector<HTMLButtonElement>('.questions-view__choice[data-value="2"]')!.click();
    expect(c.querySelector<HTMLButtonElement>(".questions-view__diagnose")!.disabled).toBe(false);
  });
});

describe("describeMap", () => {
  it("円の要因と点数、タイプを決めた要因を文章にする", () => {
    const f = (id: string, label: string, score: number) =>
      ({ id, label, score, description: "", relatedFactorIds: [] }) as unknown as Factor;
    expect(describeMap([f("a", "反すう/考え続ける状態", 93), f("b", "孤独/つながり不足", 62)], ["a"])).toBe(
      "診断マップ。反すう/考え続ける状態 93点、孤独/つながり不足 62点。タイプを決めた要因は 反すう/考え続ける状態。"
    );
  });
});
