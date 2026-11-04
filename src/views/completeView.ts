/**
 * CompleteView (完了画面 F-15)
 *
 * design.md「Component 構成」の CompleteView に相当。Router から描画される
 * フレームワーク非依存 (Vanilla TS DOM) の画面コンポーネント。
 *
 * 要件対応 (Requirement 13):
 *   - 13.2 完了画面が表示されたとき、一連の診断体験が完了した旨を示す完了表示を提示する。
 *
 * 完了後の後戻り禁止 (Req 13.3) は Router 側のゲートで担保されるため、本 View は
 * 完了表示の提示のみを責務とする。結果再表示 (Req 17, 要検討) の拡張ポイントとして、
 * 任意の導線を注入できるようにしている。
 */

/** CompleteView の描画に必要な依存 (すべて任意)。 */
export interface CompleteViewOptions {
  /**
   * 結果再表示の導線 (F-25 / Req 17, 要検討)。
   * 指定された場合のみ「診断結果を再表示する」ボタンを有効状態で表示する。
   */
  onReplayResult?: () => void;
}

/**
 * renderCompleteView: container に完了画面を描画する。
 *
 * 冪等に再描画できるよう描画前に container をクリアし、破棄関数を返す。
 */
export function renderCompleteView(
  container: HTMLElement,
  options: CompleteViewOptions = {},
): () => void {
  const { onReplayResult } = options;

  container.replaceChildren();

  const section = document.createElement("section");
  section.className = "view view--complete";
  section.setAttribute("aria-labelledby", "complete-title");
  // 完了を支援技術にも伝えるためライブリージョンとする。
  section.setAttribute("role", "status");
  section.setAttribute("aria-live", "polite");

  // 完了表示 (Req 13.2)
  const title = document.createElement("h1");
  title.id = "complete-title";
  title.className = "view__title";
  title.textContent = "診断が完了しました";
  section.appendChild(title);

  const message = document.createElement("p");
  message.className = "view__lead";
  message.dataset.role = "completion-message";
  message.textContent =
    "一連の診断体験はこれで終了です。ご協力ありがとうございました。";
  section.appendChild(message);

  let onReplayClick: (() => void) | undefined;
  let replayButton: HTMLButtonElement | undefined;

  // 結果再表示の導線 (任意・Req 17 要検討)。
  if (onReplayResult) {
    replayButton = document.createElement("button");
    replayButton.type = "button";
    replayButton.className = "button button--secondary";
    replayButton.dataset.action = "replay-result";
    replayButton.textContent = "診断結果を再表示する";
    onReplayClick = () => onReplayResult();
    replayButton.addEventListener("click", onReplayClick);
    section.appendChild(replayButton);
  }

  container.appendChild(section);

  return () => {
    if (replayButton && onReplayClick) {
      replayButton.removeEventListener("click", onReplayClick);
    }
  };
}
