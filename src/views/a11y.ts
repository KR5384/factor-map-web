/**
 * 画面共通のアクセシビリティ補助。
 *
 * SPA では画面を切り替えてもブラウザがページ遷移として扱わないため、
 * 支援技術の利用者には「画面が変わった」ことが伝わらない。
 * 画面の見出しへフォーカスを移して、新しい画面の先頭から読み上げられるようにする。
 */

/**
 * focusViewHeading: container 内の最初の h1 (なければ h2) へフォーカスを移す。
 *
 * 見出しはもともとフォーカスできない要素なので tabindex="-1" を付ける
 * (Tab 移動の順番には入らず、スクリプトからだけフォーカスできる)。
 *
 * @returns フォーカスを移せたら true
 */
export function focusViewHeading(container: HTMLElement): boolean {
  const heading = container.querySelector<HTMLElement>("h1") ?? container.querySelector<HTMLElement>("h2");
  if (!heading) return false;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  return true;
}

/** 見た目には出さず、読み上げだけさせる要素のクラス名。 */
export const VISUALLY_HIDDEN = "visually-hidden";
