/**
 * SurveyStore: アンケート状態管理とバリデーション (F-04 事前 / F-14 事後)
 *
 * 事前/事後アンケートの入力値 (clarity / conviction / freeText) を保持し、
 * 送信前のバリデーションを行う。
 *
 * - clarity / conviction が 1〜5 の整数であること (Req 4.1, 4.2, 12.1, 12.2)
 * - 自由記述が 1000 文字以内であること (Req 4.1, 4.2, 12.1, 12.2)
 * - 不正時は送信を中止できるよう対象フィールドを返し、入力済みの値は保持する (Req 14.4)
 *
 * design.md「Data Models」の SurveyAnswer と、Component: SurveyStore 契約に準拠する。
 */

import {
  SURVEY_SCALE_MIN,
  SURVEY_SCALE_MAX,
  FREE_TEXT_MAX_LENGTH,
  type SurveyAnswer,
} from "../models/types";

/** アンケート種別。事前は conviction を持たず、事後は conviction を必須とする。 */
export type SurveyKind = "pre" | "post";

/** バリデーション対象フィールド名 (強調表示の識別子に用いる) */
export type SurveyField = "clarity" | "conviction" | "freeText";

/**
 * バリデーション結果。
 * - valid が true のとき invalidFields は空配列
 * - valid が false のとき invalidFields に不正なフィールドが列挙される (強調表示用)
 */
export interface SurveyValidationResult {
  valid: boolean;
  invalidFields: SurveyField[];
}

/**
 * 保持中のアンケート入力値。
 * 尺度は未入力を表現するため number | undefined とする。
 */
export interface SurveyInput {
  clarity?: number;
  conviction?: number;
  freeText?: string;
}

/**
 * clarity / conviction が 1〜5 の整数であるかを判定する。
 * undefined・非整数・範囲外はすべて不正とする。
 */
export function isValidScale(value: number | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SURVEY_SCALE_MIN &&
    value <= SURVEY_SCALE_MAX
  );
}

/**
 * 自由記述が 1000 文字以内かを判定する。
 * 未入力 (undefined / 空文字) は任意項目のため有効とする。
 */
export function isValidFreeText(value: string | undefined): boolean {
  if (value === undefined) return true;
  return value.length <= FREE_TEXT_MAX_LENGTH;
}

/** SurveyStore の公開契約 */
export interface SurveyStore {
  /** 対象アンケート種別 ("pre" | "post") */
  readonly kind: SurveyKind;
  /** clarity を設定する (入力保持) */
  setClarity(value: number | undefined): void;
  /** conviction を設定する (事後のみ意味を持つ。事前では保持しても検証に用いない) */
  setConviction(value: number | undefined): void;
  /** freeText を設定する (入力保持) */
  setFreeText(value: string | undefined): void;
  /** 現在の入力値のスナップショットを返す (入力保持の確認用) */
  getInput(): SurveyInput;
  /** 現在の入力を検証し、不正フィールドを列挙した結果を返す。状態は変更しない (値は保持) */
  validate(): SurveyValidationResult;
  /** 検証に通る場合のみ送信用の SurveyAnswer を返す。不正時は null (送信中止) */
  buildAnswer(): SurveyAnswer | null;
}

/** SurveyStore の実装 */
class SurveyStoreImpl implements SurveyStore {
  readonly kind: SurveyKind;
  private clarity?: number;
  private conviction?: number;
  private freeText?: string;

  constructor(kind: SurveyKind) {
    this.kind = kind;
  }

  setClarity(value: number | undefined): void {
    this.clarity = value;
  }

  setConviction(value: number | undefined): void {
    this.conviction = value;
  }

  setFreeText(value: string | undefined): void {
    this.freeText = value;
  }

  getInput(): SurveyInput {
    return {
      clarity: this.clarity,
      conviction: this.conviction,
      freeText: this.freeText,
    };
  }

  validate(): SurveyValidationResult {
    const invalidFields: SurveyField[] = [];

    // clarity は事前/事後ともに 1〜5 の整数が必須 (Req 4.2, 12.2)
    if (!isValidScale(this.clarity)) {
      invalidFields.push("clarity");
    }

    // conviction は事後アンケートのみ 1〜5 の整数が必須 (Req 12.2)
    if (this.kind === "post" && !isValidScale(this.conviction)) {
      invalidFields.push("conviction");
    }

    // 自由記述は 1000 文字以内 (Req 4.2, 12.2)
    if (!isValidFreeText(this.freeText)) {
      invalidFields.push("freeText");
    }

    return {
      valid: invalidFields.length === 0,
      invalidFields,
    };
  }

  buildAnswer(): SurveyAnswer | null {
    const result = this.validate();
    // 不正時は送信を中止 (null)。入力済み値は内部状態に保持されたまま (Req 14.4)
    if (!result.valid) {
      return null;
    }

    const answer: SurveyAnswer = {
      clarity: this.clarity as number,
    };
    if (this.kind === "post") {
      answer.conviction = this.conviction as number;
    }
    if (this.freeText !== undefined && this.freeText.length > 0) {
      answer.freeText = this.freeText;
    }
    return answer;
  }
}

/** SurveyStore を生成する */
export function createSurveyStore(kind: SurveyKind): SurveyStore {
  return new SurveyStoreImpl(kind);
}
