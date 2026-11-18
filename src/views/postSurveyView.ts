/**
 * PostSurveyView (事後アンケート画面 F-14)
 *
 * 設問は事前事後アンケート案 (2026-11-11 改訂) の A1〜A4＋感想。
 * B群 (比較群) は結果を見る前に答えるので A3・A4 を表示しない。
 * 送信すると API-03 で保存され、完了画面へ進む。
 */

import type { ApiClient } from "@/api/apiClient";
import {
  COMMENT_MAX_LENGTH,
  SCALE_OPTIONS,
  validatePostSurvey,
  type Group,
  type PostSurveyInput,
} from "@/store/surveyStore";
import { createRadioGroup, createTextArea, highlightFields } from "@/views/surveyFields";

export interface PostSurveyViewOptions {
  apiClient: ApiClient;
  /** API-01 で発行された診断ID */
  getDiagnosisId: () => string | undefined;
  /** API-01 で振られた群 */
  getGroup: () => Group;
  navigateToComplete: () => void;
}

export function renderPostSurveyView(container: HTMLElement, options: PostSurveyViewOptions): () => void {
  const { apiClient, getDiagnosisId, getGroup, navigateToComplete } = options;
  const group = getGroup();
  const input: PostSurveyInput = {};
  let submitting = false;

  container.replaceChildren();

  const section = document.createElement("section");
  section.className = "view view--post-survey";

  const title = document.createElement("h1");
  title.className = "view__title";
  title.textContent = "事後アンケート";
  section.appendChild(title);

  const lead = document.createElement("p");
  lead.className = "view__lead";
  lead.textContent =
    group === "A"
      ? "診断結果を見たうえで、いまのあなたの状態についてもう一度教えてください（約1分）。診断前と同じ質問もありますが、いまの気持ちで答えてください。"
      : "いまのあなたの状態について、もう一度教えてください（約1分）。診断前と同じ質問もありますが、いまの気持ちで答えてください。";
  section.appendChild(lead);

  const form = document.createElement("form");
  form.className = "survey__form";
  form.noValidate = true;

  form.append(
    createRadioGroup({
      field: "explain",
      legend: "いま、自分が何にもやもやしているのかを、言葉で説明できる",
      name: "post-explain",
      options: SCALE_OPTIONS,
      onSelect: (v) => (input.explain = v),
    }),
    createRadioGroup({
      field: "relation",
      legend: "いま、自分のもやもやの原因同士が、どうつながっているか分かる",
      name: "post-relation",
      options: SCALE_OPTIONS,
      onSelect: (v) => (input.relation = v),
    })
  );
  if (group === "A") {
    form.append(
      createRadioGroup({
        field: "fit",
        legend: "診断結果は、いまの自分の状態に当てはまっていると思う",
        name: "post-fit",
        options: SCALE_OPTIONS,
        onSelect: (v) => (input.fit = v),
      }),
      createRadioGroup({
        field: "discovery",
        legend: "診断結果を見て、自分では気づいていなかったもやもやの原因に気づいた",
        name: "post-discovery",
        options: SCALE_OPTIONS,
        onSelect: (v) => (input.discovery = v),
      })
    );
  }
  form.appendChild(
    createTextArea({
      field: "comment",
      label: "診断を受けてみた感想があれば教えてください",
      note: `お名前、会社名、連絡先など、個人が分かる内容は書かないでください。（${COMMENT_MAX_LENGTH}文字まで）`,
      maxLength: COMMENT_MAX_LENGTH,
      onInput: (v) => (input.comment = v),
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
  submit.dataset.action = "submit";
  submit.textContent = "送信する";
  form.appendChild(submit);

  const showError = (message: string): void => {
    error.textContent = message;
    error.hidden = message.length === 0;
  };

  const onSubmit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (submitting) return;

    const invalid = validatePostSurvey(input, group);
    highlightFields(form, invalid);
    if (invalid.length > 0) {
      showError("未回答の項目があります。色の付いた項目を確認してください。");
      return;
    }
    showError("");

    submitting = true;
    submit.disabled = true;
    try {
      const res = await apiClient.postPostSurvey({
        diagnosisId: getDiagnosisId() ?? "",
        explain: input.explain as number,
        relation: input.relation as number,
        fit: group === "A" ? input.fit : undefined,
        discovery: group === "A" ? input.discovery : undefined,
        comment: input.comment,
      });
      if (res.ok) {
        navigateToComplete();
        return;
      }
      if (res.error.fields?.length) highlightFields(form, res.error.fields);
      showError(
        res.error.code === "NETWORK" || res.error.code === "TIMEOUT"
          ? "通信に失敗しました。もう一度「送信する」を押してください。"
          : res.error.code === "NOT_FOUND" || res.error.code === "PRECONDITION"
            ? "診断の情報が見つかりませんでした。お手数ですが最初からやり直してください。"
            : "送信できませんでした。入力内容を確認して、もう一度お試しください。"
      );
    } finally {
      submitting = false;
      submit.disabled = false;
    }
  };

  form.addEventListener("submit", onSubmit);
  section.appendChild(form);
  container.appendChild(section);

  return () => form.removeEventListener("submit", onSubmit);
}
