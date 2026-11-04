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

  // Req 3.1: 利用同意の説明文を表示する。
  const explanation = document.createElement("p");
  explanation.className = "consent__explanation";
  explanation.textContent =
    "本診断で入力いただいた回答は、匿名の研究データとして診断前後の気持ちの変化の分析に利用します。個人を特定する情報は収集しません。内容をご確認のうえ、同意するかどうかをお選びください。";
  section.appendChild(explanation);

  // Req 3.1: 「同意」「非同意」の2つの選択肢を、いずれも未選択の初期状態で表示する。
  const fieldset = document.createElement("fieldset");
  fieldset.className = "consent__choices";

  const legend = document.createElement("legend");
  legend.className = "consent__legend";
  legend.textContent = "研究データの利用に同意しますか？";
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
  section.appendChild(confirmButton);

  const getSelected = (): ConsentChoice | undefined => {
    if (agreeRadio.input.checked) return "agree";
    if (declineRadio.input.checked) return "decline";
    return undefined;
  };

  const onChoiceChange = (): void => {
    // いずれかが選択されたら確定ボタンを有効化する。
    confirmButton.disabled = getSelected() === undefined;
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
