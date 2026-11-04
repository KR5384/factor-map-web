/**
 * QuestionsView (質問画面)
 *
 * design.md Component「QuestionsView」に相当する画面コンポーネント。
 * DiagnosisStore と連携して、回答受付・進捗表示・質問の前後移動・必須チェックを担う。
 *
 * 本ファイルではタスク 11.3 の範囲として以下を実装する:
 *   - 現在表示中の質問 (store.currentIndex()) を 5 件のリッカート選択肢とともに描画する
 *   - 選択肢の選択で store.setAnswer を呼ぶ (Requirements 5.1)
 *   - 進捗 (回答済み / 総数 / 残り) を表示する (Requirements 6.1, 6.2, 6.3)
 *   - 前へ / 次へ で store.gotoPrev / store.gotoNext を呼び再描画する (Requirements 7.1, 7.2)
 *   - 「診断する」で store.validateRequired を実行し、
 *       - 未回答一覧が非空なら result 遷移を中止し未回答箇所を強調表示する (Requirements 8.3, 8.4)
 *       - 未回答一覧が空なら navigate(result 相当) を呼ぶ
 *
 * View はフレームワーク非依存の Vanilla TS として実装し、
 * コンテナ要素と依存 (store / questions / onNavigateToResult) を注入して生成する。
 */

import type { DiagnosisStore } from "@/store/diagnosisStore";
import { CHOICE_VALUES, type ChoiceValue, type QuestionId } from "@/models/types";

// ============================================================
// 質問定義
// ============================================================

/**
 * 1 問分の質問定義。
 * - id:      質問ID ("q1"〜"q20")
 * - text:    設問文
 * - choices: リッカート尺度 5 件のラベル。index 0〜4 が ChoiceValue "0"〜"4" に対応する。
 */
export interface QuestionDef {
  id: QuestionId;
  text: string;
  choices: [string, string, string, string, string];
}

// ============================================================
// QuestionsView の契約
// ============================================================

/** QuestionsView の契約。 */
export interface QuestionsView {
  /** 現在の状態に基づいて画面を (再) 描画する。 */
  render(): void;
}

/** createQuestionsView の生成オプション。 */
export interface CreateQuestionsViewOptions {
  /** 描画先コンテナ要素。 */
  container: HTMLElement;
  /** 回答・進捗・前後移動・必須チェックを担うストア。 */
  store: DiagnosisStore;
  /** 20 問の質問定義 (id / text / 5 択ラベル)。 */
  questions: QuestionDef[];
  /** 必須チェックを満たしたときに診断結果画面へ遷移するコールバック。 */
  onNavigateToResult: () => void;
}

// ============================================================
// 実装
// ============================================================

/**
 * createQuestionsView: 質問画面コンポーネントを生成する。
 *
 * render() を呼ぶと、現在表示中の質問 (store.currentIndex()) を描画する。
 * 選択肢の選択・前後移動・診断実行はいずれも内部で store を操作し、
 * 必要に応じて再描画する (自己再帰的な render 呼び出し)。
 */
export function createQuestionsView(
  options: CreateQuestionsViewOptions,
): QuestionsView {
  const { container, store, questions, onNavigateToResult } = options;

  // 「診断する」で未回答一覧が非空だった場合に強調すべき質問IDの集合 (Req 8.4)。
  // 次に render するときに該当質問であれば強調表示に用いる。
  let missingHighlights: ReadonlySet<QuestionId> = new Set<QuestionId>();

  /** 表示中の質問番号 (1-based) に対応する質問定義を取得する。 */
  function currentQuestion(): QuestionDef | undefined {
    const index = store.currentIndex(); // 1〜20
    return questions[index - 1];
  }

  /**
   * render: 現在の状態に基づいて画面を描画する。
   *
   * - 進捗バー (回答済み / 総数 / 残り)
   * - 設問文
   * - 5 件のリッカート選択肢 (選択済みは aria-pressed)
   * - 前へ / 次へ ボタン (境界では無効化)
   * - 診断する ボタン
   * - 未回答強調時の案内メッセージ
   */
  function render(): void {
    container.replaceChildren();

    const question = currentQuestion();
    if (!question) {
      // 想定外: 質問定義が不足している場合は何も描画しない。
      return;
    }

    const root = document.createElement("section");
    root.className = "questions-view";
    root.setAttribute("aria-label", "診断の質問");

    root.appendChild(createProgress());
    root.appendChild(createQuestionBlock(question));
    root.appendChild(createNavControls());

    // 未回答強調中は案内メッセージを表示する (Req 8.4 の補助)。
    if (missingHighlights.size > 0) {
      const notice = document.createElement("p");
      notice.className = "questions-view__notice";
      notice.setAttribute("role", "alert");
      notice.textContent = `未回答の質問が ${missingHighlights.size} 件あります。すべての質問に回答してください。`;
      root.appendChild(notice);
    }

    container.appendChild(root);
  }

  /** 進捗表示 (F-08 / Req 6.1, 6.2, 6.3) を生成する。 */
  function createProgress(): HTMLElement {
    const progress = store.progress();
    const wrapper = document.createElement("div");
    wrapper.className = "questions-view__progress";

    const text = document.createElement("p");
    text.className = "questions-view__progress-text";
    text.dataset.answered = String(progress.answered);
    text.dataset.total = String(progress.total);
    text.dataset.remaining = String(progress.remaining);
    text.textContent = `回答済み ${progress.answered} / ${progress.total} 問（残り ${progress.remaining} 問）`;

    wrapper.appendChild(text);

    // 進捗ゲージ: 回答済み割合を塗り幅で表す。
    const bar = document.createElement("div");
    bar.className = "questions-view__progress-bar";
    const fill = document.createElement("div");
    fill.className = "questions-view__progress-fill";
    const ratio = progress.total > 0 ? progress.answered / progress.total : 0;
    fill.style.width = `${Math.round(ratio * 100)}%`;
    bar.appendChild(fill);
    wrapper.appendChild(bar);

    return wrapper;
  }

  /** 設問文と 5 件の選択肢を含むブロックを生成する。 */
  function createQuestionBlock(question: QuestionDef): HTMLElement {
    const block = document.createElement("div");
    block.className = "questions-view__question";
    block.dataset.questionId = question.id;

    // 未回答強調対象なら強調クラスを付与する (Req 8.4)。
    if (missingHighlights.has(question.id)) {
      block.classList.add("questions-view__question--missing");
      block.dataset.missing = "true";
    }

    const index = store.currentIndex();
    const heading = document.createElement("h2");
    heading.className = "questions-view__heading";
    heading.textContent = `Q${index}. ${question.text}`;
    block.appendChild(heading);

    const choiceList = document.createElement("div");
    choiceList.className = "questions-view__choices";
    choiceList.setAttribute("role", "group");
    choiceList.setAttribute("aria-label", `${question.text} の回答`);

    const selected = store.getAnswer(question.id);

    question.choices.forEach((label, i) => {
      const value = CHOICE_VALUES[i] as ChoiceValue;
      choiceList.appendChild(
        createChoiceButton(question.id, value, label, selected === value),
      );
    });

    block.appendChild(choiceList);
    return block;
  }

  /** 1 件の選択肢ボタンを生成する。選択で setAnswer を呼び再描画する。 */
  function createChoiceButton(
    questionId: QuestionId,
    value: ChoiceValue,
    label: string,
    isSelected: boolean,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = isSelected
      ? "questions-view__choice questions-view__choice--selected"
      : "questions-view__choice";
    button.dataset.value = value;
    button.setAttribute("aria-pressed", String(isSelected));
    button.textContent = label;

    button.addEventListener("click", () => {
      // 回答を保持する (Req 5.1)。選択後は強調を解除して再描画する。
      store.setAnswer(questionId, value);
      missingHighlights = new Set<QuestionId>();
      render();
    });

    return button;
  }

  /** 前へ / 次へ / 診断する の操作ボタン群を生成する。 */
  function createNavControls(): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "questions-view__controls";

    const index = store.currentIndex();

    // 前へ (Req 7.2 / 7.4): 先頭 (1) では無効化する。
    const prevButton = document.createElement("button");
    prevButton.type = "button";
    prevButton.className = "questions-view__prev";
    prevButton.textContent = "前へ";
    prevButton.disabled = index <= 1;
    prevButton.addEventListener("click", () => {
      store.gotoPrev();
      render();
    });
    controls.appendChild(prevButton);

    // 次へ (Req 7.1 / 7.3): 末尾 (20) では無効化する。
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "questions-view__next";
    nextButton.textContent = "次へ";
    nextButton.disabled = index >= store.progress().total;
    nextButton.addEventListener("click", () => {
      store.gotoNext();
      render();
    });
    controls.appendChild(nextButton);

    // 診断する (Req 8.3 / 8.4): 必須チェックを実行して遷移制御する。
    const diagnoseButton = document.createElement("button");
    diagnoseButton.type = "button";
    diagnoseButton.className = "questions-view__diagnose";
    diagnoseButton.textContent = "診断する";
    diagnoseButton.addEventListener("click", () => {
      handleDiagnose();
    });
    controls.appendChild(diagnoseButton);

    return controls;
  }

  /**
   * handleDiagnose: 「診断する」押下時の処理 (F-10 / Req 8.3, 8.4)。
   *
   * - store.validateRequired() の結果が非空なら、result への遷移を中止し、
   *   未回答の質問IDを強調対象として記録したうえで再描画する (Req 8.3, 8.4)。
   * - 空配列なら onNavigateToResult を呼び診断結果画面へ進む。
   */
  function handleDiagnose(): void {
    const missing = store.validateRequired();

    if (missing.length > 0) {
      // 未回答あり: 遷移を中止し、未回答箇所を強調表示する (Req 8.3, 8.4)。
      missingHighlights = new Set<QuestionId>(missing);
      // 最初の未回答質問へ移動して利用者に示す。
      const firstMissingIndex = indexOfQuestion(missing[0]);
      if (firstMissingIndex !== -1) {
        moveToIndex(firstMissingIndex + 1);
      }
      render();
      return;
    }

    // 全問回答済み: 強調を解除し診断結果画面へ遷移する (Req 8 完了ケース)。
    missingHighlights = new Set<QuestionId>();
    onNavigateToResult();
  }

  /** 質問IDの questions 配列上のインデックス (0-based) を返す。見つからなければ -1。 */
  function indexOfQuestion(questionId: QuestionId): number {
    return questions.findIndex((q) => q.id === questionId);
  }

  /**
   * moveToIndex: 表示中質問番号を targetIndex (1-based) まで前後移動で合わせる。
   *
   * DiagnosisStore は番号を直接設定する API を持たないため、現在位置との差分だけ
   * gotoNext / gotoPrev を呼んで移動する (境界は store 側でクランプされる)。
   */
  function moveToIndex(targetIndex: number): void {
    let guard = store.progress().total; // 無限ループ防止の上限。
    while (store.currentIndex() < targetIndex && guard-- > 0) {
      store.gotoNext();
    }
    guard = store.progress().total;
    while (store.currentIndex() > targetIndex && guard-- > 0) {
      store.gotoPrev();
    }
  }

  return { render };
}
