/**
 * ConsentView (利用同意画面 F-03)
 *
 * design.md「Component 構成」の ConsentView に相当。Router から描画される
 * フレームワーク非依存 (Vanilla TS DOM) の画面コンポーネント。
 *
 * 要件対応 (Requirement 3):
 *   - 3.1 利用同意の説明文と「同意」「非同意」の2つの選択肢を、いずれも未選択の初期状態で表示する
 *         → ラジオを checked 無しで生成し、確定ボタンは初期状態で無効にする。
 *   - 3.2 同意を選択すると Consent を「同意あり」として記録し、(1秒以内に) 事前アンケート画面へ遷移する
 *         → onConsent 呼び出し後に navigate("preSurvey") を同期的に実行する。
 *   - 3.3 Consent が「同意あり」として記録される際、クライアント生成の sessionId と
 *         ISO8601 形式の同意日時を当該 Session に関連付ける
 *         → onConsent(sessionId, consentAt) に sessionId と new Date().toISOString() を渡す。
 *   - 3.4 非同意を選択すると Consent を記録せず、(1秒以内に) トップ画面へ戻す
 *         → onDecline を呼び navigate("top") を実行する。同意記録は行わない。
 *   - 3.6 同意画面へ遷移した時点で sessionId が存在しない場合、同意の記録に先立って
 *         sessionId を1つ生成し当該 Session に割り当てる
 *         → getSessionId() が空/未設定なら generateSessionId() で生成してから onConsent に渡す。
 *
 * 同意状態の記録・sessionId の保持は呼び出し側 (ストア等) が注入するコールバックへ委譲し、
 * View 自身は Router/ストアへ直接依存しない。
 */

import type { ViewName } from "@/router/router";

/** ConsentView の描画に必要な依存。 */
export interface ConsentViewOptions {
  /** 指定画面へ遷移するコールバック (Router.navigate を配線する)。 */
  navigate: (view: ViewName) => void;
  /**
   * 現在の sessionId を返す。未生成の場合は undefined または空文字列を返す (Req 3.6)。
   */
  getSessionId: () => string | undefined;
  /**
   * sessionId を生成して Session へ割り当てるコールバック (Req 3.6)。
   * getSessionId が非空を返す場合は呼ばれない。
   * 省略時は crypto.randomUUID() で生成する。
   */
  generateSessionId?: () => string;
  /**
   * 同意記録コールバック (Req 3.2 / 3.3)。
   * 「同意あり」の記録と、sessionId・ISO8601 同意日時の Session への関連付けを行う。
   * @param sessionId 非空の sessionId
   * @param consentAt ISO8601 形式の同意日時
   */
  onConsent: (sessionId: string, consentAt: string) => void;
  /**
   * 非同意コールバック (Req 3.4)。同意記録は行わない。
   * 省略可能。呼び出し後にトップ画面へ遷移する。
   */
  onDecline?: () => void;
}

/** 選択肢の値。 */
type ConsentChoice = "agree" | "decline";

/**
 * renderConsentView: container に同意画面を描画する。
 *
 * 冪等に再描画できるよう、描画前に container の既存内容をクリアする。
 * 戻り値として破棄関数 (登録したイベントリスナの解除) を返す。
 */
export function renderConsentView(
  container: HTMLElement,
  options: ConsentViewOptions,
): () => void {
  const { navigate, getSessionId, onConsent, onDecline } = options;
  const generateSessionId =
    options.generateSessionId ?? (() => crypto.randomUUID());

  container.replaceChildren();

  const section = document.createElement("section");
  section.className = "view view--consent";
  section.setAttribute("aria-labelledby", "consent-title");

  const title = document.createElement("h1");
  title.id = "consent-title";
  title.className = "view__title";
  title.textContent = "利用同意";
  section.appendChild(title);

  // Req 3.1: 利用同意の説明。要約 (3点) を常に見せ、詳しい説明は開いて読む。
  section.appendChild(buildConsentExplanation());

  // Req 3.1: 「同意」「非同意」の2つの選択肢を、いずれも未選択の初期状態で表示する。
  const fieldset = document.createElement("fieldset");
  fieldset.className = "consent__choices";

  const legend = document.createElement("legend");
  legend.className = "consent__legend";
  legend.textContent = "上の内容を読み、研究データの利用に同意しますか？";
  fieldset.appendChild(legend);

  const agreeRadio = createChoiceRadio("agree", "同意する");
  const declineRadio = createChoiceRadio("decline", "同意しない");
  fieldset.appendChild(agreeRadio.wrapper);
  fieldset.appendChild(declineRadio.wrapper);
  section.appendChild(fieldset);

  // 確定ボタン: 初期状態 (未選択) では無効 (Req 3.1 の未選択初期状態を表現)。
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "button button--primary";
  confirmButton.dataset.action = "confirm-consent";
  confirmButton.textContent = "決定";
  confirmButton.disabled = true;

  // 無効なボタンだけでは押せない理由が分からないので、案内を添える。
  const hint = document.createElement("p");
  hint.id = "consent-hint";
  hint.className = "consent__hint";
  hint.textContent = "どちらかを選ぶと「決定」を押せます。";
  confirmButton.setAttribute("aria-describedby", hint.id);

  section.appendChild(hint);
  section.appendChild(confirmButton);

  const getSelected = (): ConsentChoice | undefined => {
    if (agreeRadio.input.checked) return "agree";
    if (declineRadio.input.checked) return "decline";
    return undefined;
  };

  const onChoiceChange = (): void => {
    // いずれかが選択されたら確定ボタンを有効化する。
    confirmButton.disabled = getSelected() === undefined;
    hint.hidden = !confirmButton.disabled;
    if (confirmButton.disabled) confirmButton.setAttribute("aria-describedby", hint.id);
    else confirmButton.removeAttribute("aria-describedby");
  };
  agreeRadio.input.addEventListener("change", onChoiceChange);
  declineRadio.input.addEventListener("change", onChoiceChange);

  const onConfirm = (): void => {
    const choice = getSelected();
    if (choice === undefined) {
      // 未選択時は何もしない (確定ボタンは無効のため通常到達しない)。
      return;
    }

    if (choice === "agree") {
      // Req 3.6: sessionId が存在しなければ記録に先立って生成する。
      let sessionId = getSessionId();
      if (sessionId === undefined || sessionId === "") {
        sessionId = generateSessionId();
      }
      // Req 3.3: ISO8601 形式の同意日時を生成する。
      const consentAt = new Date().toISOString();
      // Req 3.2 / 3.3: 「同意あり」を記録し sessionId・同意日時を Session へ関連付ける。
      onConsent(sessionId, consentAt);
      // Req 3.2: 記録後に事前アンケート画面へ遷移する。
      navigate("preSurvey");
      return;
    }

    // choice === "decline"
    // Req 3.4: 同意記録は行わず、トップ画面へ戻す。
    onDecline?.();
    navigate("top");
  };
  confirmButton.addEventListener("click", onConfirm);

  container.appendChild(section);

  return () => {
    agreeRadio.input.removeEventListener("change", onChoiceChange);
    declineRadio.input.removeEventListener("change", onChoiceChange);
    confirmButton.removeEventListener("click", onConfirm);
  };
}

/** ラジオ選択肢 (ラベルで包んだ input) を生成する。初期状態は未選択。 */
function createChoiceRadio(
  value: ConsentChoice,
  labelText: string,
): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = document.createElement("label");
  wrapper.className = "consent__choice";

  const input = document.createElement("input");
  input.type = "radio";
  input.name = "consent-choice";
  input.value = value;
  input.dataset.choice = value;
  // Req 3.1: 初期状態は未選択 (checked を設定しない)。
  wrapper.appendChild(input);

  const span = document.createElement("span");
  span.className = "consent__choice-label";
  span.textContent = labelText;
  wrapper.appendChild(span);

  return { wrapper, input };
}

// ============================================================
// 利用同意の文 (2026-11-26 改訂。版は config.ts の CONSENT_VERSION)
// ============================================================

/** 要約 (最初から表示する3点)。 */
export const CONSENT_SUMMARY: readonly string[] = [
  "① 入力した回答と診断結果は、匿名の研究データとして使います。",
  "② 参加は自由です。途中でやめることも、あとから回答の削除を頼むこともできます。",
  "③ この診断は、医療的な診断ではありません。",
];

/** 詳しい説明 (開いたときに表示)。items があれば箇条書き、texts は段落。 */
export const CONSENT_DETAILS: readonly { heading: string; texts?: string[]; items?: string[]; after?: string[] }[] = [
  {
    heading: "この研究について",
    texts: [
      "この診断は、BIPROGY研究会 関東10G が、「心のもやもやの要因を見える形で示すと、自分が何にもやもやしているのかを理解しやすくなるか」を調べるために行う研究です。",
    ],
  },
  {
    heading: "集める情報",
    items: [
      "事前・事後アンケートの回答（年代は答えなくてもかまいません）",
      "診断の20問への回答と、診断結果",
      "感想（任意）",
      "回答した日時",
    ],
  },
  {
    heading: "集めない情報",
    items: [
      "名前・メールアドレス・所属など、あなたが誰かが分かる情報",
      "IPアドレスや端末の情報（研究データとしては記録しません）",
    ],
    after: ["感想欄には、名前や勤務先など、あなたやほかの人が誰か分かる内容は書かないでください。"],
  },
  {
    heading: "データの扱い",
    items: [
      "回答は、個人が特定できない形でクラウドサービス（Cloudflare）上に保存します。",
      "回答は統計的に処理し、研究会の報告書や成果発表で公表することがあります。個人が特定される形では公表しません。",
      "データは研究会の活動が終わるまで保存し、その後削除します。研究チーム以外にデータを渡すことはありません。",
    ],
  },
  {
    heading: "参加は自由です",
    texts: [
      "同意するかどうかは自由です。同意しない場合はこの診断を利用できず、トップ画面に戻ります。同意しなくても、途中でやめても、不利益はありません。",
      "途中でやめた場合、それまでの回答は分析に使いません。",
    ],
  },
  {
    heading: "回答の削除",
    texts: [
      "診断を最後まで終えると「診断ID」が表示されます。削除を希望するときは、この診断IDを研究メンバーにお伝えください。回答は匿名のため、診断IDがないとどの回答か特定できず、削除できません。分析や公表がすでに終わった後は、結果から取り除けないことがあります。",
    ],
  },
  {
    heading: "気持ちへの配慮",
    texts: [
      "この診断は医療的な診断ではなく、病気や心の状態を判断するものではありません。結果は、気持ちを整理するきっかけとしてお使いください。答えていてつらくなったときは、無理せず途中でやめてください。",
    ],
  },
];

function buildConsentExplanation(): HTMLElement {
  const box = document.createElement("div");
  box.className = "consent__explanation";

  const summary = document.createElement("ul");
  summary.className = "consent__summary";
  for (const line of CONSENT_SUMMARY) {
    const li = document.createElement("li");
    li.textContent = line;
    summary.appendChild(li);
  }
  box.appendChild(summary);

  // 詳しい説明は <details> で開閉する (キーボード・読み上げにもそのまま対応)。
  const details = document.createElement("details");
  details.className = "consent__details";
  const toggle = document.createElement("summary");
  toggle.className = "consent__details-toggle";
  toggle.textContent = "詳しい説明を読む";
  details.appendChild(toggle);

  const body = document.createElement("div");
  body.className = "consent__details-body";
  for (const block of CONSENT_DETAILS) {
    const h = document.createElement("h2");
    h.className = "consent__details-heading";
    h.textContent = block.heading;
    body.appendChild(h);
    for (const t of block.texts ?? []) {
      const p = document.createElement("p");
      p.textContent = t;
      body.appendChild(p);
    }
    if (block.items) {
      const ul = document.createElement("ul");
      for (const t of block.items) {
        const li = document.createElement("li");
        li.textContent = t;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
    for (const t of block.after ?? []) {
      const p = document.createElement("p");
      p.textContent = t;
      body.appendChild(p);
    }
  }
  details.appendChild(body);
  box.appendChild(details);
  return box;
}
