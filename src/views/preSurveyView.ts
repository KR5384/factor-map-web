/**
 * PreSurveyView (事前アンケート画面 F-04)
 *
 * design.md「Component: PreSurveyView」/「主要フロー」に準拠する。
 * SurveyStore("pre") と ApiClient を用い、事前アンケート(整理度 clarity + 任意自由記述)を
 * 入力・検証・送信し、保存成功後に質問画面へ遷移する。
 *
 * 要件対応 (Requirement 4):
 *   - 4.1 clarity の 1〜5 の尺度入力と 0〜1000 文字の任意自由記述欄を、いずれも未入力の初期状態で表示する
 *   - 4.2 clarity が 1〜5 の整数でない / 自由記述が 1000 文字超で送信された場合、送信を中止し、
 *         対象項目を強調表示し、入力済みの値を保持する
 *   - 4.3 clarity が 1〜5 の整数かつ sessionId が非空のとき ApiClient.postPreSurvey を呼ぶ
 *   - 4.7 保存成功の受信後 1 秒以内に質問画面へ遷移する (成功コールバックを即時呼び出し)
 *
 * 本 View はフレームワーク非依存の Vanilla TS / DOM 実装であり、
 * コンテナ要素と依存 (SurveyStore・ApiClient・sessionId ゲッタ・成功コールバック) を
 * 注入されるファクトリとして提供する。描画・配線のみを担い、
 * Router/Store/ApiClient 実装そのものには手を加えない。
 */

import {
  SURVEY_SCALE_MIN,
  SURVEY_SCALE_MAX,
  FREE_TEXT_MAX_LENGTH,
} from "@/models/types";
import type {
  SurveyStore,
  SurveyField,
  SurveyValidationResult,
} from "@/store/surveyStore";
import type { ApiClient } from "@/api/apiClient";

// ============================================================
// 依存・契約
// ============================================================

/**
 * PreSurveyView の生成に必要な依存。
 *
 * View を Router/Store/ApiClient の生成箇所から疎結合に保つため、
 * 具体的な実装ではなくインターフェースと関数を注入する。
 */
export interface PreSurveyViewDeps {
  /** 事前アンケート用の SurveyStore ("pre")。入力保持と検証を担う。 */
  store: SurveyStore;
  /** 事前アンケート POST を担う ApiClient。 */
  apiClient: ApiClient;
  /**
   * 現在の sessionId を取得するゲッタ。
   * 同意時に割り当てられた sessionId を都度参照する (遅延評価)。
   */
  getSessionId(): string | undefined | null;
  /**
   * 保存成功後に質問画面へ遷移するためのコールバック。
   * Req 4.7: 保存成功の受信後 1 秒以内に質問画面へ遷移する。
   * 同期的に呼び出すことで即時遷移を保証する。
   */
  onSuccess(): void;
}

/** PreSurveyView の公開契約。 */
export interface PreSurveyView {
  /** 画面を描画する (初期状態は未入力)。 */
  render(): void;
  /** 画面内容を破棄する (コンテナをクリア)。 */
  destroy(): void;
}

// ============================================================
// DOM 要素の識別子 (テスト・配線で参照)
// ============================================================

const CLASS = {
  root: "pre-survey",
  clarityGroup: "pre-survey__clarity",
  clarityOption: "pre-survey__clarity-option",
  freeText: "pre-survey__free-text",
  submit: "pre-survey__submit",
  error: "pre-survey__error",
  /** 強調表示 (Req 4.2) 用のクラス。対象フィールドに付与する。 */
  invalid: "is-invalid",
} as const;

const NAME = {
  clarity: "clarity",
} as const;

// ============================================================
// 実装
// ============================================================

/**
 * createPreSurveyView: 事前アンケート画面を生成する。
 *
 * @param container 描画先コンテナ要素
 * @param deps      注入する依存 (store / apiClient / getSessionId / onSuccess)
 */
export function createPreSurveyView(
  container: HTMLElement,
  deps: PreSurveyViewDeps
): PreSurveyView {
  const { store, apiClient, getSessionId, onSuccess } = deps;

  // 多重送信防止フラグ。送信処理中は true。
  let submitting = false;

  // 描画後に保持する要素参照。destroy/再描画で使い回す。
  let rootEl: HTMLFormElement | null = null;
  let clarityInputs: HTMLInputElement[] = [];
  let freeTextEl: HTMLTextAreaElement | null = null;
  let errorEl: HTMLParagraphElement | null = null;

  /** clarity の強調表示を更新する (対象フィールドに is-invalid を付与/除去)。 */
  function applyInvalidHighlight(invalidFields: SurveyField[]): void {
    const invalid = new Set<SurveyField>(invalidFields);

    const clarityGroup = rootEl?.querySelector(`.${CLASS.clarityGroup}`);
    if (clarityGroup) {
      clarityGroup.classList.toggle(CLASS.invalid, invalid.has("clarity"));
    }
    if (freeTextEl) {
      freeTextEl.classList.toggle(CLASS.invalid, invalid.has("freeText"));
    }
  }

  /** エラーメッセージを表示する。message が空なら非表示にする。 */
  function showError(message: string): void {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = message.length === 0;
  }

  /**
   * 送信ハンドラ。
   *
   * 1. SurveyStore で検証 (Req 4.2)。不正なら送信を中止し対象項目を強調、値は保持。
   * 2. sessionId が非空であることを確認 (Req 4.3 / 4.4)。
   * 3. ApiClient.postPreSurvey を呼ぶ (Req 4.3)。
   * 4. 成功時は onSuccess を即時呼び出して質問画面へ遷移 (Req 4.7)。
   */
  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    // 1. 検証 (値は SurveyStore 内に保持されたまま)。
    const validation: SurveyValidationResult = store.validate();
    if (!validation.valid) {
      applyInvalidHighlight(validation.invalidFields);
      showError("入力内容を確認してください。");
      return;
    }

    // 2. 送信前提条件: clarity 妥当かつ sessionId 非空 (Req 4.3 / 4.4)。
    const answer = store.buildAnswer();
    const sessionId = getSessionId();
    if (answer === null) {
      // 念のため: validate 通過後に buildAnswer が null になることは無いが防御的に扱う。
      applyInvalidHighlight(store.validate().invalidFields);
      showError("入力内容を確認してください。");
      return;
    }
    if (!isNonEmpty(sessionId)) {
      // sessionId 不在は clarity とは別の前提条件違反。対象を強調 (Req 4.4)。
      showError("セッションが見つかりません。やり直してください。");
      return;
    }

    // 強調・エラーをクリアして送信に入る。
    applyInvalidHighlight([]);
    showError("");

    // 3. POST 送信。
    submitting = true;
    setSubmitDisabled(true);
    try {
      const res = await apiClient.postPreSurvey({
        sessionId,
        clarity: answer.clarity,
        freeText: answer.freeText,
      });

      if (res.ok) {
        // 4. 保存成功 → 即時に質問画面へ遷移 (Req 4.7)。
        onSuccess();
        return;
      }

      // 保存失敗: 通知はエラー経路 (ErrorHandler) が担うが、画面側でも案内を出す。
      // 入力不正応答 (fields) があれば該当項目を強調する (Req 4.2 と整合)。
      const fields = res.error.fields as SurveyField[] | undefined;
      if (fields && fields.length > 0) {
        applyInvalidHighlight(fields);
      }
      showError(res.error.message || "保存に失敗しました。再試行してください。");
    } finally {
      submitting = false;
      setSubmitDisabled(false);
    }
  }

  /** 送信ボタンの活性/非活性を切り替える。 */
  function setSubmitDisabled(disabled: boolean): void {
    const submit = rootEl?.querySelector<HTMLButtonElement>(
      `.${CLASS.submit}`
    );
    if (submit) submit.disabled = disabled;
  }

  /** clarity 選択変更時に SurveyStore へ反映する。 */
  function handleClarityChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (!target.checked) return;
    const value = Number(target.value);
    store.setClarity(value);
    // 入力されたら clarity の強調を解除する (値は保持)。
    const clarityGroup = rootEl?.querySelector(`.${CLASS.clarityGroup}`);
    clarityGroup?.classList.remove(CLASS.invalid);
  }

  /** 自由記述変更時に SurveyStore へ反映する。 */
  function handleFreeTextInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    store.setFreeText(target.value);
    if (target.value.length <= FREE_TEXT_MAX_LENGTH) {
      target.classList.remove(CLASS.invalid);
    }
  }

  function render(): void {
    container.replaceChildren();

    const form = document.createElement("form");
    form.className = CLASS.root;
    form.setAttribute("novalidate", "");
    form.noValidate = true;
    rootEl = form;

    // 見出し・説明
    const heading = document.createElement("h1");
    heading.textContent = "事前アンケート";
    form.appendChild(heading);

    const lead = document.createElement("p");
    lead.textContent =
      "診断を始める前に、今のもやもやの整理度を教えてください。";
    form.appendChild(lead);

    // ---- clarity 尺度入力 (1〜5)。初期は未選択 (Req 4.1) ----
    const fieldset = document.createElement("fieldset");
    fieldset.className = CLASS.clarityGroup;

    const legend = document.createElement("legend");
    legend.textContent = "もやもやの整理度 (1: 整理できていない 〜 5: 整理できている)";
    fieldset.appendChild(legend);

    clarityInputs = [];
    for (let value = SURVEY_SCALE_MIN; value <= SURVEY_SCALE_MAX; value++) {
      const label = document.createElement("label");
      label.className = CLASS.clarityOption;

      const input = document.createElement("input");
      input.type = "radio";
      input.name = NAME.clarity;
      input.value = String(value);
      // 初期は未選択 (checked を付与しない / Req 4.1)。
      input.addEventListener("change", handleClarityChange);

      const text = document.createElement("span");
      text.textContent = String(value);

      label.appendChild(input);
      label.appendChild(text);
      fieldset.appendChild(label);
      clarityInputs.push(input);
    }
    form.appendChild(fieldset);

    // ---- 自由記述欄 (0〜1000 文字, 任意)。初期は未入力 (Req 4.1) ----
    const freeTextLabel = document.createElement("label");
    freeTextLabel.textContent = "自由記述 (任意, 1000文字まで)";

    const freeText = document.createElement("textarea");
    freeText.className = CLASS.freeText;
    freeText.maxLength = FREE_TEXT_MAX_LENGTH;
    freeText.rows = 4;
    freeText.value = ""; // 初期は空 (Req 4.1)。
    freeText.addEventListener("input", handleFreeTextInput);
    freeTextEl = freeText;

    freeTextLabel.appendChild(freeText);
    form.appendChild(freeTextLabel);

    // ---- エラーメッセージ (初期は非表示) ----
    const error = document.createElement("p");
    error.className = CLASS.error;
    error.setAttribute("role", "alert");
    error.hidden = true;
    errorEl = error;
    form.appendChild(error);

    // ---- 送信ボタン ----
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = CLASS.submit;
    submit.textContent = "診断へ進む";
    form.appendChild(submit);

    form.addEventListener("submit", handleSubmit);

    container.appendChild(form);
  }

  function destroy(): void {
    container.replaceChildren();
    rootEl = null;
    clarityInputs = [];
    freeTextEl = null;
    errorEl = null;
  }

  return { render, destroy };
}

/** 非空文字列かを判定する (sessionId 前提条件 Req 4.3 / 4.4)。 */
function isNonEmpty(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
