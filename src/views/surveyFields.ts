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
  for (const option of opts.options) {
    const label = document.createElement("label");
    label.className = "survey__choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = opts.name;
    input.value = String(option.value);
    input.addEventListener("change", () => {
      if (!input.checked) return;
      fieldset.classList.remove(INVALID_CLASS);
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
      fieldset.classList.remove(INVALID_CLASS);
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
    fieldset.classList.remove(INVALID_CLASS);
    opts.onInput(textarea.value);
  });
  fieldset.appendChild(textarea);
  return fieldset;
}

/** 指定した項目だけを強調表示する */
export function highlightFields(form: HTMLElement, fields: string[]): void {
  const set = new Set(fields);
  form.querySelectorAll<HTMLElement>(".survey__field").forEach((el) => {
    const invalid = set.has(el.dataset.field ?? "");
    el.classList.toggle(INVALID_CLASS, invalid);
    if (invalid) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  });
}

function createFieldset(field: string, legendText: string, optional = false): HTMLFieldSetElement {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "survey__field";
  fieldset.dataset.field = field;
  const legend = document.createElement("legend");
  legend.className = "survey__legend";
  legend.textContent = optional ? `${legendText}（任意）` : legendText;
  fieldset.appendChild(legend);
  return fieldset;
}
