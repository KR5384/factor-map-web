/**
 * AboutView (アプリ説明画面 F-02)
 *
 * design.md「Component 構成」の AboutView に相当。Router から描画される
 * フレームワーク非依存 (Vanilla TS DOM) の画面コンポーネント。
 *
 * 要件対応 (Requirement 2):
 *   - 2.1 アプリの目的・診断手順・研究目的の3要素をすべて同一画面上に表示する
 *         → 3つの説明セクションを常に生成する。
 *   - 2.2 同意画面へ進む導線を表示する
 *         → 「同意へ進む」ボタンを生成する。
 *   - 2.3 当該導線を選択すると (1秒以内に) 同意画面 ("consent") へ遷移する
 *         → ボタン押下で navigate("consent") を同期的に呼ぶ。
 *
 * 画面遷移の実処理は navigate コールバックへ委譲し、View は Router/ストアに直接依存しない。
 */

import type { ViewName } from "@/router/router";

/** AboutView の描画に必要な依存。 */
export interface AboutViewOptions {
  /** 指定画面へ遷移するコールバック (Router.navigate を配線する)。 */
  navigate: (view: ViewName) => void;
}

/** 説明の1要素 (見出し + 本文)。Req 2.1 の3要素を表す。 */
interface AboutSectionContent {
  /** data 属性で識別するためのキー (purpose / steps / research)。 */
  key: string;
  heading: string;
  body: string;
}

/** Req 2.1: 目的・手順・研究目的の3要素。 */
const ABOUT_SECTIONS: readonly AboutSectionContent[] = [
  {
    key: "purpose",
    heading: "このアプリの目的",
    body: "心のもやもやの要因を見える化し、気持ちの整理のきっかけを提供することを目的としています。",
  },
  {
    key: "steps",
    heading: "診断の手順",
    body: "診断前のアンケートに答えたあと、20問の質問に回答します。回答に基づいて診断マップと要因の詳細を表示し、最後に診断後のアンケートに答えていただきます。",
  },
  {
    key: "research",
    heading: "研究目的について",
    body: "回答内容は匿名の研究データとして、診断前後の気持ちの変化の分析に利用します。個人を特定する情報は収集しません。",
  },
];

/**
 * renderAboutView: container に説明画面を描画する。
 *
 * 冪等に再描画できるよう、描画前に container の既存内容をクリアする。
 * 戻り値として破棄関数 (登録したイベントリスナの解除) を返す。
 */
export function renderAboutView(
  container: HTMLElement,
  options: AboutViewOptions,
): () => void {
  const { navigate } = options;

  container.replaceChildren();

  const section = document.createElement("section");
  section.className = "view view--about";
  section.setAttribute("aria-labelledby", "about-title");

  const title = document.createElement("h1");
  title.id = "about-title";
  title.className = "view__title";
  title.textContent = "アプリの説明";
  section.appendChild(title);

  // Req 2.1: 目的・手順・研究目的の3要素をすべて同一画面上に表示する。
  for (const content of ABOUT_SECTIONS) {
    const article = document.createElement("article");
    article.className = "about-section";
    article.dataset.section = content.key;

    const heading = document.createElement("h2");
    heading.className = "about-section__heading";
    heading.textContent = content.heading;
    article.appendChild(heading);

    const body = document.createElement("p");
    body.className = "about-section__body";
    body.textContent = content.body;
    article.appendChild(body);

    section.appendChild(article);
  }

  // Req 2.2: 同意画面へ進む導線を表示する。
  const consentButton = document.createElement("button");
  consentButton.type = "button";
  consentButton.className = "button button--primary";
  consentButton.dataset.action = "to-consent";
  consentButton.textContent = "同意へ進む";

  // Req 2.3: 導線選択で同意画面へ遷移する。
  const onToConsent = (): void => {
    navigate("consent");
  };
  consentButton.addEventListener("click", onToConsent);
  section.appendChild(consentButton);

  container.appendChild(section);

  return () => {
    consentButton.removeEventListener("click", onToConsent);
  };
}
