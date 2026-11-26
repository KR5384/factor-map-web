/**
 * アンケート画面 (事前・事後) で共通に使う入力部品。
 * Vanilla TS / DOM。fieldset に class="survey__field" と data-field を付け、強調表示はここで行う。
 */

import type { Option } from "@/store/surveyStore";

export const INVALID_CLASS = "survey__field--invalid";

/** 単一選択 (ラジオ) のグループ。初期状態は未選択 */
export function createRadioGroup<T extends string | number>(opts: {
  field: string;
  legend: string;
  name: string;
  options: Option<T>[];
  onSelect: (value: T) => void;
  optional?: boolean;
}): HTMLFieldSetElement {
  const fieldset = createFieldset(opts.field, opts.legend, opts.optional);
  fieldset.dataset.errorMessage = "1つ選んでください";
  for (const option of opts.options) {
    const label = document.createElement("label");
    label.className = "survey__choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = opts.name;
    input.value = String(option.value);
    input.addEventListener("change", () => {
      if (!input.checked) return;
      setFieldInvalid(fieldset, false);
      opts.onSelect(option.value);
    });
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(input, text);
    fieldset.appendChild(label);
  }
  return fieldset;
}

/**
 * 複数選択 (チェックボックス) のグループ。
 * onToggle が返した選択に合わせてチェック状態を揃える (排他の選択肢に対応するため)。
 */
export function createCheckboxGroup(opts: {
  field: string;
  legend: string;
  note?: string;
  options: Option<number>[];
  onToggle: (value: number, checked: boolean) => number[];
}): HTMLFieldSetElement {
  const fieldset = createFieldset(opts.field, opts.legend);
  fieldset.dataset.errorMessage = "1つ以上選んでください";
  if (opts.note) {
    const note = document.createElement("p");
    note.className = "survey__note";
    note.textContent = opts.note;
    fieldset.appendChild(note);
  }
  const inputs: HTMLInputElement[] = [];
  for (const option of opts.options) {
    const label = document.createElement("label");
    label.className = "survey__choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(option.value);
    input.addEventListener("change", () => {
      setFieldInvalid(fieldset, false);
      const selected = new Set(opts.onToggle(option.value, input.checked));
      for (const el of inputs) el.checked = selected.has(Number(el.value));
    });
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(input, text);
    fieldset.appendChild(label);
    inputs.push(input);
  }
  return fieldset;
}

/** 自由記述欄 (任意) */
export function createTextArea(opts: {
  field: string;
  label: string;
  note?: string;
  maxLength: number;
  onInput: (value: string) => void;
}): HTMLFieldSetElement {
  const fieldset = createFieldset(opts.field, opts.label, true);
  if (opts.note) {
    const note = document.createElement("p");
    note.className = "survey__note";
    note.textContent = opts.note;
    fieldset.appendChild(note);
  }
  const textarea = document.createElement("textarea");
  textarea.className = "survey__textarea";
  textarea.rows = 4;
  textarea.maxLength = opts.maxLength;
  textarea.addEventListener("input", () => {
    setFieldInvalid(fieldset, false);
    opts.onInput(textarea.value);
  });
  fieldset.appendChild(textarea);
  return fieldset;
}

/** 項目ごとのエラー文の要素のクラス名。 */
const FIELD_ERROR_CLASS = "survey__field-error";

/**
 * 指定した項目だけを強調表示する。
 *
 * 色だけに頼らないよう、強調した項目には「1つ選んでください」などの文を出し、
 * aria-describedby で項目に結び付けて読み上げられるようにする。
 */
export function highlightFields(form: HTMLElement, fields: string[]): void {
  const set = new Set(fields);
  form.querySelectorAll<HTMLElement>(".survey__field").forEach((el) => {
    setFieldInvalid(el, set.has(el.dataset.field ?? ""));
  });
}

/** 強調した項目のうち最初のものの、最初の入力欄へフォーカスを移す。 */
export function focusFirstInvalid(form: HTMLElement): void {
  form
    .querySelector<HTMLElement>(`.${INVALID_CLASS} input, .${INVALID_CLASS} textarea`)
    ?.focus();
}

/** 1つの項目の強調とエラー文を付け外しする。 */
function setFieldInvalid(fieldset: HTMLElement, invalid: boolean): void {
  fieldset.classList.toggle(INVALID_CLASS, invalid);
  const errorId = `${fieldset.dataset.field ?? "field"}-error`;
  let message = fieldset.querySelector<HTMLElement>(`.${FIELD_ERROR_CLASS}`);
  if (!invalid) {
    message?.remove();
    fieldset.removeAttribute("aria-describedby");
    fieldset.querySelectorAll("input, textarea").forEach((i) => i.removeAttribute("aria-invalid"));
    return;
  }
  if (!message) {
    message = document.createElement("p");
    message.className = FIELD_ERROR_CLASS;
    message.id = errorId;
    message.textContent = fieldset.dataset.errorMessage ?? "この項目に答えてください";
    // legend のすぐ後ろ (選択肢の前) に置き、見落とされないようにする。
    fieldset.querySelector("legend")?.after(message);
  }
  fieldset.setAttribute("aria-describedby", errorId);
  fieldset.querySelectorAll("input, textarea").forEach((i) => i.setAttribute("aria-invalid", "true"));
}

function createFieldset(field: string, legendText: string, optional = false): HTMLFieldSetElement {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "survey__field";
  fieldset.dataset.field = field;
  const legend = document.createElement("legend");
  legend.className = "survey__legend";
  legend.textContent = legendText;
  if (optional) {
    const tag = document.createElement("span");
    tag.className = "survey__optional";
    tag.textContent = "（任意）";
    legend.appendChild(tag);
  }
  fieldset.appendChild(legend);
  return fieldset;
}
