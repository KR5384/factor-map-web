/**
 * PreSurveyView (事前アンケート画面 F-03 / F-04)
 *
 * 設問は事前事後アンケート案 (2026-11-11 改訂) の P0〜P3＋年代。
 * 送信すると API-01 で利用同意と回答が保存され、診断ID・群・テストモードかが返る。
 * 成功したら onSuccess で診断IDなどを呼び出し側へ渡し、質問画面へ進む。
 */

import type { ApiClient, PreSurveyResponse } from "@/api/apiClient";
import {
  AGE_OPTIONS,
  CAUSE_OPTIONS,
  FREQUENCY_OPTIONS,
  SCALE_OPTIONS,
  toggleCause,
  validatePreSurvey,
  type PreSurveyInput,
} from "@/store/surveyStore";
import {
  createCheckboxGroup,
  createRadioGroup,
  focusFirstInvalid,
  highlightFields,
} from "@/views/surveyFields";

export interface PreSurveyViewDeps {
  apiClient: ApiClient;
  /** 保存に成功したとき (診断IDなどを受け取って質問画面へ進む) */
  onSuccess(result: PreSurveyResponse): void;
}

export interface PreSurveyView {
  render(): void;
  destroy(): void;
}

export function createPreSurveyView(container: HTMLElement, deps: PreSurveyViewDeps): PreSurveyView {
  const input: PreSurveyInput = { causes: [] };
  let submitting = false;

  function render(): void {
    container.replaceChildren();

    const section = document.createElement("section");
    section.className = "view view--pre-survey";

    const title = document.createElement("h1");
    title.className = "view__title";
    title.textContent = "事前アンケート";
    section.appendChild(title);

    const lead = document.createElement("p");
    lead.className = "view__lead";
    lead.textContent =
      "診断の前に、いまのあなたの状態について教えてください（約1分）。" +
      "この診断でいう「もやもや」とは、便利になった生活の中でも、どこかすっきりしない・満たされない・" +
      "引っかかりが残る感覚のことです。正解はありません。いまの気持ちに近いものを選んでください。";
    section.appendChild(lead);

    const requiredNote = document.createElement("p");
    requiredNote.className = "survey__required-note";
    requiredNote.textContent = "「（任意）」と書いた項目のほかは、すべてお答えください。";
    section.appendChild(requiredNote);

    const form = document.createElement("form");
    form.className = "survey__form";
    form.noValidate = true;

    form.append(
      createRadioGroup({
        field: "frequency",
        legend: "最近、もやもやを感じることはありますか",
        name: "pre-frequency",
        options: FREQUENCY_OPTIONS,
        onSelect: (v) => (input.frequency = v),
      }),
      createRadioGroup({
        field: "explain",
        legend: "いま、自分が何にもやもやしているのかを、言葉で説明できる",
        name: "pre-explain",
        options: SCALE_OPTIONS,
        onSelect: (v) => (input.explain = v),
      }),
      createRadioGroup({
        field: "relation",
        legend: "いま、自分のもやもやの原因同士が、どうつながっているか分かる",
        name: "pre-relation",
        options: SCALE_OPTIONS,
        onSelect: (v) => (input.relation = v),
      }),
      createCheckboxGroup({
        field: "causes",
        legend: "いまのもやもやの原因として、近いものをすべて選んでください",
        note: "「どれも当てはまらない」「わからない」は、ほかと同時には選べません。",
        options: CAUSE_OPTIONS,
        onToggle: (value, checked) => {
          input.causes = toggleCause(input.causes, value, checked);
          return input.causes;
        },
      }),
      createRadioGroup({
        field: "ageGroup",
        legend: "年代を教えてください",
        name: "pre-age",
        options: AGE_OPTIONS,
        onSelect: (v) => (input.ageGroup = v),
        optional: true,
      })
    );

    const error = document.createElement("p");
    error.className = "survey__error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    form.appendChild(error);

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "button button--primary";
    submit.textContent = "診断へ進む";
    form.appendChild(submit);

    const showError = (message: string): void => {
      error.textContent = message;
      error.hidden = message.length === 0;
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting) return;

      const invalid = validatePreSurvey(input);
      highlightFields(form, invalid);
      if (invalid.length > 0) {
        showError(`未回答の項目が ${invalid.length} 件あります。「選んでください」と表示された項目に答えてください。`);
        focusFirstInvalid(form);
        return;
      }
      showError("");

      submitting = true;
      submit.disabled = true;
      try {
        const res = await deps.apiClient.postPreSurvey({
          frequency: input.frequency as number,
          explain: input.explain as number,
          relation: input.relation as number,
          causes: input.causes,
          ageGroup: input.ageGroup,
        });
        if (res.ok) {
          deps.onSuccess(res.data);
          return;
        }
        if (res.error.fields?.length) highlightFields(form, res.error.fields);
        showError(
          res.error.code === "NETWORK" || res.error.code === "TIMEOUT"
            ? "通信に失敗しました。もう一度「診断へ進む」を押してください。"
            : "送信できませんでした。入力内容を確認して、もう一度お試しください。"
        );
      } finally {
        submitting = false;
        submit.disabled = false;
      }
    });

    section.appendChild(form);
    container.appendChild(section);
  }

  function destroy(): void {
    container.replaceChildren();
  }

  return { render, destroy };
}
