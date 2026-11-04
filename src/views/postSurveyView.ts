/**
 * PostSurveyView (事後アンケート画面 F-14)
 *
 * design.md「Component 構成」の PostSurveyView に相当。Router から描画される
 * フレームワーク非依存 (Vanilla TS DOM) の画面コンポーネント。
 *
 * 要件対応 (Requirement 12, 13):
 *   - 12.1 clarity (1〜5)・conviction (1〜5) の尺度入力と 0〜1000 文字の任意自由記述欄を、
 *          いずれも未入力の初期状態で表示する。
 *   - 12.2 clarity/conviction が 1〜5 の整数でない、または自由記述が 1000 文字超で送信された場合は、
 *          送信を中止し対象項目を強調表示し、入力済みの値を保持する (SurveyStore.validate に委譲)。
 *   - 12.3 clarity・conviction が 1〜5 の整数かつ sessionId が非空のとき postPostSurvey を呼ぶ。
 *   - 12.7 / 13.1 保存成功の受信後 1 秒以内に完了画面へ遷移する。
 *   - 13.2 完了画面側で完了表示を提示する (CompleteView)。
 *
 * View は Router やストア実装へ直接依存せず、必要な依存 (SurveyStore・ApiClient・
 * sessionId 取得関数・完了画面への遷移コールバック) を注入される。
 * 送信前提条件と検証は SurveyStore / ApiClient 側に委譲し、本 View は入力値の
 * 反映・強調表示・成功後の遷移トリガのみを担う。
 */

import {
  SURVEY_SCALE_MIN,
  SURVEY_SCALE_MAX,
  FREE_TEXT_MAX_LENGTH,
} from "@/models/types";
import type { SurveyStore, SurveyField } from "@/store/surveyStore";
import type { ApiClient } from "@/api/apiClient";

/** PostSurveyView の描画に必要な依存。 */
export interface PostSurveyViewOptions {
  /** 事後アンケート用 SurveyStore ("post" 種別)。入力保持・検証を担う。 */
  store: SurveyStore;
  /** 事後アンケートを POST する ApiClient。 */
  apiClient: ApiClient;
  /** 現在の sessionId を取得する (送信前提条件に用いる)。 */
  getSessionId: () => string | undefined;
  /** 保存成功後に完了画面へ遷移するコールバック (Router.navigate 配線用)。 */
  navigateToComplete: () => void;
}

/** 尺度入力 (1〜5) の選択肢値を生成する。 */
function scaleValues(): number[] {
  const values: number[] = [];
  for (let v = SURVEY_SCALE_MIN; v <= SURVEY_SCALE_MAX; v += 1) {
    values.push(v);
  }
  return values;
}

/**
 * 1〜5 の尺度入力 (ラジオ) を1グループ生成する。
 * name は group ごとにユニークにし、初期状態ではいずれも未選択とする (Req 12.1)。
 */
function createScaleGroup(
  field: Extract<SurveyField, "clarity" | "conviction">,
  legendText: string,
  onSelect: (value: number) => void,
): { fieldset: HTMLFieldSetElement } {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "survey__field";
  fieldset.dataset.field = field;

  const legend = document.createElement("legend");
  legend.className = "survey__legend";
  legend.textContent = legendText;
  fieldset.appendChild(legend);

  for (const value of scaleValues()) {
    const label = document.createElement("label");
    label.className = "survey__scale-option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = `post-${field}`;
    input.value = String(value);
    // 初期は未選択 (Req 12.1)。checked は設定しない。
    input.addEventListener("change", () => {
      if (input.checked) {
        onSelect(value);
      }
    });

    const text = document.createElement("span");
    text.textContent = String(value);

    label.appendChild(input);
    label.appendChild(text);
    fieldset.appendChild(label);
  }

  return { fieldset };
}

/**
 * renderPostSurveyView: container に事後アンケート画面を描画する。
 *
 * 冪等に再描画できるよう描画前に container をクリアし、破棄関数を返す。
 */
export function renderPostSurveyView(
  container: HTMLElement,
  options: PostSurveyViewOptions,
): () => void {
  const { store, apiClient, getSessionId, navigateToComplete } = options;

  container.replaceChildren();

  const section = document.createElement("section");
  section.className = "view view--post-survey";
  section.setAttribute("aria-labelledby", "post-survey-title");

  const title = document.createElement("h1");
  title.id = "post-survey-title";
  title.className = "view__title";
  title.textContent = "事後アンケート";
  section.appendChild(title);

  const lead = document.createElement("p");
  lead.className = "view__lead";
  lead.textContent =
    "診断を終えての、もやもやの整理度と納得度をお聞かせください。";
  section.appendChild(lead);

  const form = document.createElement("form");
  form.className = "survey__form";
  form.noValidate = true;

  // clarity (整理度) 尺度入力 (Req 12.1)
  const clarity = createScaleGroup(
    "clarity",
    "もやもやの整理度 (1〜5)",
    (value) => store.setClarity(value),
  );
  form.appendChild(clarity.fieldset);

  // conviction (納得度) 尺度入力 (Req 12.1)
  const conviction = createScaleGroup(
    "conviction",
    "診断結果への納得度 (1〜5)",
    (value) => store.setConviction(value),
  );
  form.appendChild(conviction.fieldset);

  // 自由記述 (任意・0〜1000 文字) (Req 12.1)
  const freeTextWrap = document.createElement("div");
  freeTextWrap.className = "survey__field";
  freeTextWrap.dataset.field = "freeText";

  const freeTextLabel = document.createElement("label");
  freeTextLabel.className = "survey__label";
  freeTextLabel.htmlFor = "post-free-text";
  freeTextLabel.textContent = `自由記述 (任意・${FREE_TEXT_MAX_LENGTH}文字まで)`;
  freeTextWrap.appendChild(freeTextLabel);

  const freeText = document.createElement("textarea");
  freeText.id = "post-free-text";
  freeText.className = "survey__textarea";
  freeText.rows = 4;
  // 初期は未入力 (Req 12.1)。value は空のまま。
  freeText.addEventListener("input", () => {
    // 空文字は未入力扱いとするため undefined を渡す。
    store.setFreeText(freeText.value.length > 0 ? freeText.value : undefined);
  });
  freeTextWrap.appendChild(freeText);
  form.appendChild(freeTextWrap);

  // 強調表示対象のフィールド要素を引けるようにマップ化する。
  const fieldElements: Record<SurveyField, HTMLElement> = {
    clarity: clarity.fieldset,
    conviction: conviction.fieldset,
    freeText: freeTextWrap,
  };

  /** 全フィールドの強調表示を解除する。 */
  const clearHighlights = (): void => {
    for (const el of Object.values(fieldElements)) {
      el.classList.remove("survey__field--invalid");
      el.removeAttribute("aria-invalid");
    }
  };

  /** 指定フィールドを強調表示する (Req 12.2)。 */
  const highlightInvalid = (fields: SurveyField[]): void => {
    for (const field of fields) {
      const el = fieldElements[field];
      el.classList.add("survey__field--invalid");
      el.setAttribute("aria-invalid", "true");
    }
  };

  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.className = "button button--primary";
  submitButton.dataset.action = "submit";
  submitButton.textContent = "送信する";
  form.appendChild(submitButton);

  const onSubmit = (event: Event): void => {
    event.preventDefault();

    clearHighlights();

    // 検証: 不正時は送信を中止し対象項目を強調表示 (入力値は Store が保持) (Req 12.2)
    const result = store.validate();
    if (!result.valid) {
      highlightInvalid(result.invalidFields);
      return;
    }

    const answer = store.buildAnswer();
    // validate が通っていれば answer は非 null。型の都合で防御的に確認する。
    if (answer === null) {
      highlightInvalid(store.validate().invalidFields);
      return;
    }

    // 送信中の二重送信を防ぐ。
    submitButton.disabled = true;

    const sessionId = getSessionId();

    void apiClient
      .postPostSurvey({
        // sessionId の非空検証は ApiClient 側の前提条件ガードに委譲する (Req 12.4)。
        sessionId: sessionId ?? "",
        clarity: answer.clarity,
        conviction: answer.conviction as number,
        freeText: answer.freeText,
      })
      .then((res) => {
        if (res.ok) {
          // 保存成功の受信後 1 秒以内に完了画面へ遷移する (Req 12.7, 13.1)。
          // navigate は同期的に呼び、即時遷移する (1 秒以内を満たす)。
          navigateToComplete();
          return;
        }
        // 送信前提条件エラー等。対象項目を強調表示し再入力を促す (Req 12.4)。
        submitButton.disabled = false;
        const fields = toSurveyFields(res.error.fields);
        if (fields.length > 0) {
          highlightInvalid(fields);
        }
      })
      .catch(() => {
        // 通信失敗等は ApiClient が ErrorHandler へ委譲済み。ここでは再送可能に戻す。
        submitButton.disabled = false;
      });
  };

  form.addEventListener("submit", onSubmit);
  section.appendChild(form);
  container.appendChild(section);

  return () => {
    form.removeEventListener("submit", onSubmit);
  };
}

/** ApiClient のエラー fields (任意) を SurveyField 配列へ変換する。 */
function toSurveyFields(fields: string[] | undefined): SurveyField[] {
  if (!fields) return [];
  const known: SurveyField[] = ["clarity", "conviction", "freeText"];
  return fields.filter((f): f is SurveyField =>
    (known as string[]).includes(f),
  );
}
