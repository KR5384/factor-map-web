/**
 * 要因間のつながり (マップの矢印) 定義。
 *
 * 結果画面で見せる「からまり」は、設問の重みから機械的に作ったものではなく、
 * 調査 (アンケートの自由記述分析・既存研究) で根拠を確認できたつながりだけを使う。
 * 1人分の20問からは、その人固有のつながりは推定できないため。
 *
 * 根拠の状態:
 *   - "confirmed"   : 根拠を確認済み。実線で表示する
 *   - "unconfirmed" : 設問の意図にはあるが、調査の裏付けは未確認。点線で表示する
 *
 * 新しいつながりを追加するときは、根拠 (evidence) を必ず記載し、
 * 確認できるまでは status を "unconfirmed" にしておくこと。
 * 根拠のないつながりは登録しない (登録しなければ画面にも出ない)。
 */

/** つながりの根拠の状態。 */
export type LinkStatus = "confirmed" | "unconfirmed";

/** 要因間の向きのあるつながり (from → to)。 */
export interface MapLink {
  /** 起点の要因 id */
  from: string;
  /** 終点の要因 id */
  to: string;
  /** 根拠の状態 (実線 / 点線の切り替え) */
  status: LinkStatus;
  /** 利用者に見せる説明文 */
  message: string;
  /** 根拠の出所 (開発・報告書用。画面には出さない) */
  evidence: string;
}

/**
 * 登録済みのつながり一覧。
 *
 * 出所:
 *   - BIP研現状整理_研究方向比較版_v5.xlsx の自由記述の分析
 *     「情報が多い → 選べない／考え続ける」
 */
export const FACTOR_LINKS: readonly MapLink[] = [
  {
    from: "info_overload",
    to: "indecision",
    status: "confirmed",
    message: "情報が多いと、何から選べばいいか分からなくなることがあります",
    evidence: "v5 自由記述の分析: 情報が多い→選べない",
  },
  {
    from: "info_overload",
    to: "rumination",
    status: "confirmed",
    message: "情報が多いと、考えが止まらなくなることがあります",
    evidence: "v5 自由記述の分析: 情報が多い→考え続ける",
  },
  {
    from: "future_uncertainty",
    to: "indecision",
    status: "unconfirmed",
    message: "将来が不安だと、決断を先延ばしにしやすくなることがあります",
    evidence:
      "設問Q20の意図にはあるが、調査の裏付けは未確認 (根拠が確認でき次第 confirmed へ)",
  },
];

/**
 * linksAmong: 表示中の要因どうしをつなぐリンクだけを返す純粋関数。
 *
 * 起点・終点の両方が visibleFactorIds に含まれるものだけを残す。
 * 登録順を保つ。
 */
export function linksAmong(
  visibleFactorIds: Iterable<string>,
  links: readonly MapLink[] = FACTOR_LINKS
): MapLink[] {
  const visible = new Set(visibleFactorIds);
  return links.filter((l) => visible.has(l.from) && visible.has(l.to));
}
