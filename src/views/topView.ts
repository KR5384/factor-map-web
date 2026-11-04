/**
 * TopView (トップ画面 F-01)
 *
 * design.md「Component 構成」の TopView に相当。Router から描画される
 * フレームワーク非依存 (Vanilla TS DOM) の画面コンポーネント。
 *
 * 要件対応 (Requirement 1):
 *   - 1.1 初回ロード完了から2秒以内にトップ画面を表示する
 *         → render は同期的に DOM を構築するため、呼び出し時点で即時表示が完了する。
 *   - 1.2 診断開始への導線を、選択操作が可能な有効状態で表示する
 *         → 開始ボタンを disabled なしで生成する。
 *   - 1.3 診断開始への導線を選択すると説明画面 ("about") へ遷移する
 *         → ボタン押下で navigate("about") を呼ぶ。
 *
 * 画面遷移の実処理 (Router.navigate) は呼び出し側が注入する navigate コールバックに委譲し、
 * View 自身は Router やストアへ直接依存しない。
 */

import type { ViewName } from "@/router/router";

/** TopView の描画に必要な依存。 */
export interface TopViewOptions {
  /** 指定画面へ遷移するコールバック (Router.navigate を配線する)。 */
  navigate: (view: ViewName) => void;
}

/**
 * renderTopView: container にトップ画面を描画する。
 *
 * 冪等に再描画できるよう、描画前に container の既存内容をクリアする。
 * 戻り値として破棄関数 (登録したイベントリスナの解除) を返す。
 */
export function renderTopView(
  container: HTMLElement,
  options: TopViewOptions,
): () => void {
  const { navigate } = options;

  container.replaceChildren();

  const section = document.createElement("section");
  section.className = "view view--top";
  section.setAttribute("aria-labelledby", "top-title");

  const title = document.createElement("h1");
  title.id = "top-title";
  title.className = "view__title";
  title.textContent = "もやもや診断";
  section.appendChild(title);

  const lead = document.createElement("p");
  lead.className = "view__lead";
  lead.textContent =
    "20問の質問に答えると、あなたの心のもやもやの要因を診断マップで可視化します。";
  section.appendChild(lead);

  // 診断開始への導線 (Req 1.2): 有効状態 (disabled を付与しない) で生成する。
  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "button button--primary";
  startButton.dataset.action = "start";
  startButton.textContent = "診断を始める";

  // Req 1.3: 選択で説明画面へ遷移する。
  const onStart = (): void => {
    navigate("about");
  };
  startButton.addEventListener("click", onStart);
  section.appendChild(startButton);

  container.appendChild(section);

  return () => {
    startButton.removeEventListener("click", onStart);
  };
}
