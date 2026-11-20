/**
 * 結果表示ボーダー (ハイブリッド判定)。
 *
 * 設問＆ロジック最終設計書「② ユーザーへの結果表示ボーダー」に準拠する。
 *   1. 最もスコアが高い分類は、点数に関わらず必ず表示する (主原因)
 *   2. 2位以降は次の条件をともに満たす分類のみ追加表示する
 *        [条件A] 相対ボーダー: 1位のスコアの 80% 以上
 *        [条件B] 絶対ボーダー: 50 点以上
 *   3. 表示件数は上位から最大 4 分類まで
 *
 * 保存 (POST) する診断結果は全要因のままとし、この関数は画面表示にのみ用いる。
 */

import type { Factor } from "@/models/types";

/** 相対ボーダー: 1位スコアに対する割合 (80%)。整数比較のため 4/5 で扱う。 */
export const RELATIVE_BORDER_NUMERATOR = 4;
export const RELATIVE_BORDER_DENOMINATOR = 5;

/** 絶対ボーダー: この点数未満は表示しない。 */
export const ABSOLUTE_BORDER = 50;

/** 表示する分類数の上限。 */
export const MAX_DISPLAY_FACTORS = 4;

/**
 * selectDisplayFactors: 画面に表示する要因を選ぶ純粋関数。
 *
 * - 返り値は score 降順 (同点は id 昇順)。先頭が主原因。
 * - factors が空のときは空配列を返す。
 * - 1位は常に含まれる。
 *
 * score は整数なので、80% 判定は浮動小数を避けて整数の積で比較する
 * (score >= top * 0.8  ⇔  score * 5 >= top * 4)。
 */
export function selectDisplayFactors(factors: readonly Factor[]): Factor[] {
  if (factors.length === 0) return [];

  const sorted = [...factors].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const top = sorted[0];
  const rest = sorted.slice(1).filter(
    (f) =>
      f.score * RELATIVE_BORDER_DENOMINATOR >=
        top.score * RELATIVE_BORDER_NUMERATOR && f.score >= ABSOLUTE_BORDER
  );

  return [top, ...rest].slice(0, MAX_DISPLAY_FACTORS);
}
