/**
 * 必須回答チェック (F-10)
 *
 * design.md「必須回答チェックアルゴリズム (F-10)」に準拠する純粋関数。
 */

import {
  CHOICE_VALUES,
  TOTAL_QUESTIONS,
  type ChoiceValue,
  type DiagnosisAnswers,
  type QuestionId,
} from "../models/types";

/**
 * 与えられた値が有効な回答値 ("0"〜"4") かを判定する。
 */
function isValidChoice(value: unknown): value is ChoiceValue {
  return (CHOICE_VALUES as readonly string[]).includes(value as string);
}

/**
 * validateRequired: 未回答の質問IDを返す (F-10)
 *
 * q1〜q20 を走査し、値が未設定または `"0"〜"4"` のいずれでもない質問IDのみを
 * 未回答一覧として返す。
 *
 * 事前条件: TOTAL_QUESTIONS = 20
 * 事後条件:
 *   - 返り値が空配列 ⇔ 全20問が `"0"〜"4"` で回答済み (Requirements 8.2)
 *   - 返り値の各要素は未回答 or 不正値の questionId (Requirements 8.1)
 *   - 副作用なし・同一入力に対し常に同一出力
 */
export function validateRequired(
  answers: Partial<DiagnosisAnswers>,
): QuestionId[] {
  const missing: QuestionId[] = [];
  for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
    const id = `q${i}` as QuestionId;
    const value = answers[id];
    if (!isValidChoice(value)) {
      missing.push(id);
    }
  }
  return missing;
}
