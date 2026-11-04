/**
 * 診断状態管理ストア (DiagnosisStore)
 *
 * design.md Component 2「DiagnosisStore」の契約を実装する。
 * 回答の一時保持 (F-07)、進捗 (F-08)、前後移動 (F-09)、必須チェック (F-10)、
 * 中断再開 (F-24) を担う。
 *
 * 本ファイルではタスク 5.1 の範囲として以下を実装する:
 *   - setAnswer / getAnswer   (Requirements 5.1, 5.2, 5.3, 5.4)
 *   - progress                (Requirements 6.1, 6.2, 6.3)
 *   - snapshot                (回答集合の取得)
 *
 * 本ファイルではタスク 5.2 の範囲として以下も実装する:
 *   - gotoNext / gotoPrev / currentIndex  (Requirements 7.1, 7.2, 7.3, 7.4, 7.5)
 *
 * 本ファイルではタスク 15.1 の範囲として以下を実装する:
 *   - persist / restore (Requirements 16.1, 16.2, 16.3, 16.4)
 *   - PersistedState 型と parsePersistedState / restorePersistedState ヘルパ
 */

import { validateRequired } from "@/engine/validateRequired";
import {
  CHOICE_VALUES,
  STORAGE_KEY,
  TOTAL_QUESTIONS,
  type ChoiceValue,
  type DiagnosisAnswers,
  type QuestionId,
} from "@/models/types";

// ============================================================
// 進捗の戻り値型
// ============================================================

/**
 * progress() の戻り値 (F-08)。
 * - answered:  回答済みの質問数 (0〜20 の整数)
 * - total:     総質問数 (20)
 * - remaining: 残りの質問数 (total - answered, 0〜20 の整数)
 */
export interface Progress {
  answered: number;
  total: number;
  remaining: number;
}

// ============================================================
// 中断・再開の保存済み状態 (F-24)
// ============================================================

/**
 * localStorage に保存する一組の状態 (design.md「中断・再開アルゴリズム (F-24)」)。
 * - sessionId:    非空の文字列 (セッション識別子)
 * - answers:      q1〜q20 のうち回答済みの質問ID → "0"〜"4" の回答値
 * - currentIndex: 表示中の質問番号 (1〜20 の整数)
 * - consented:    同意状態 (true / false)
 */
export interface PersistedState {
  sessionId: string;
  answers: Partial<DiagnosisAnswers>;
  currentIndex: number;
  consented: boolean;
}

// ============================================================
// DiagnosisStore インターフェース
// ============================================================

/**
 * 診断状態管理ストアの契約 (design.md Component 2)。
 *
 * NOTE: gotoNext/gotoPrev は F-09 (タスク 5.2)、persist/restore は F-24
 * (タスク 15.1) で実装する。現段階では契約として宣言する。
 */
export interface DiagnosisStore {
  /** 回答を保持する (F-07)。無効値は受け付けない。 */
  setAnswer(questionId: QuestionId, choice: ChoiceValue): void;
  /** 保持中の回答を取得する。未設定なら undefined。 */
  getAnswer(questionId: QuestionId): ChoiceValue | undefined;
  /** 回答済み数・総数・残り数を返す (F-08)。 */
  progress(): Progress;
  /** 未回答の質問ID一覧を返す (F-10)。空配列なら全問回答済み。 */
  validateRequired(): QuestionId[];
  /** 次の質問へ移動する (F-09)。表示中質問番号を [1,20] にクランプする。 */
  gotoNext(): void;
  /** 前の質問へ移動する (F-09)。表示中質問番号を [1,20] にクランプする。 */
  gotoPrev(): void;
  /** 現在表示中の質問番号 (1〜20 の整数) を返す (F-09)。 */
  currentIndex(): number;
  /** セッション識別子を返す (F-24)。 */
  getSessionId(): string;
  /** 同意状態を返す (F-24)。 */
  isConsented(): boolean;
  /** 同意状態を設定する (F-24)。 */
  setConsented(consented: boolean): void;
  /**
   * 現在状態 (sessionId・回答・表示中質問番号・同意状態) を一組の保存済み状態
   * として localStorage へ書き込み、既存の保存済み状態を上書きする (F-24, Req 16.1)。
   */
  persist(): void;
  /**
   * localStorage から状態を復元する (F-24, Req 16.2, 16.4)。
   * 妥当な保存済み状態があれば sessionId・回答・表示中質問番号・同意状態を適用し
   * true を返す。不在/JSON不正/キー欠落/範囲外のときは破棄して新規開始状態を保ち
   * false を返す。
   */
  restore(): boolean;
  /** 現在の回答集合のコピーを返す。 */
  snapshot(): DiagnosisAnswers;
}

// ============================================================
// ヘルパ
// ============================================================

/** 与えられた値が有効な回答値 ("0"〜"4") かを判定する。 */
function isValidChoice(value: unknown): value is ChoiceValue {
  return (CHOICE_VALUES as readonly string[]).includes(value as string);
}

/** 表示中質問番号を [1, TOTAL_QUESTIONS] の整数へクランプする (F-09)。 */
function clampIndex(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  const n = Math.trunc(value);
  if (n < 1) {
    return 1;
  }
  if (n > TOTAL_QUESTIONS) {
    return TOTAL_QUESTIONS;
  }
  return n;
}

/** 質問ID ("q1"〜"q20") として有効かを判定する。 */
function isValidQuestionId(key: string): key is QuestionId {
  const match = /^q(\d+)$/.exec(key);
  if (match === null) {
    return false;
  }
  const n = Number(match[1]);
  return Number.isInteger(n) && n >= 1 && n <= TOTAL_QUESTIONS;
}

/**
 * 任意の値が PersistedState として妥当かを検証する (Req 16.4)。
 *
 * 妥当条件:
 *   - sessionId:    非空の文字列
 *   - answers:      プレーンオブジェクトで、各キーが q1〜q20、各値が "0"〜"4"
 *   - currentIndex: 1〜TOTAL_QUESTIONS の整数
 *   - consented:    boolean
 *
 * いずれかのキー欠落・型不一致・範囲外があれば null を返す。
 */
export function validatePersistedState(value: unknown): PersistedState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const obj = value as Record<string, unknown>;

  // sessionId: 非空文字列
  const { sessionId, currentIndex, consented } = obj;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return null;
  }

  // consented: boolean
  if (typeof consented !== "boolean") {
    return null;
  }

  // currentIndex: 1〜TOTAL_QUESTIONS の整数
  if (
    typeof currentIndex !== "number" ||
    !Number.isInteger(currentIndex) ||
    currentIndex < 1 ||
    currentIndex > TOTAL_QUESTIONS
  ) {
    return null;
  }

  // answers: オブジェクトで各エントリが (q1..q20) → ("0".."4")
  const rawAnswers = obj.answers;
  if (
    typeof rawAnswers !== "object" ||
    rawAnswers === null ||
    Array.isArray(rawAnswers)
  ) {
    return null;
  }
  const answers: Partial<DiagnosisAnswers> = {};
  for (const [key, choice] of Object.entries(
    rawAnswers as Record<string, unknown>,
  )) {
    if (!isValidQuestionId(key) || !isValidChoice(choice)) {
      return null;
    }
    answers[key] = choice;
  }

  return { sessionId, answers, currentIndex, consented };
}

/**
 * 生の文字列を PersistedState へ復元する純粋ヘルパ (副作用なし)。
 *
 * 事後条件 (Req 16.4):
 *   - rawText が null (未保存) → null
 *   - JSON パース不能 → null
 *   - パースできても検証に失敗 (キー欠落/型不一致/範囲外) → null
 *   - すべて妥当 → 正規化済み PersistedState
 *
 * localStorage へのアクセスや破損データの削除は呼び出し側が担う。
 */
export function parsePersistedState(
  rawText: string | null,
): PersistedState | null {
  if (rawText === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  return validatePersistedState(parsed);
}

/**
 * localStorage から PersistedState を復元する (副作用あり: 読取・破損データ削除)。
 *
 * 事後条件 (Req 16.2, 16.4):
 *   - 妥当な保存済み状態があれば PersistedState を返す
 *   - 不在/JSON不正/キー欠落/範囲外のときは当該データを破棄し null を返す
 */
export function restorePersistedState(): PersistedState | null {
  let rawText: string | null;
  try {
    rawText = localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage が利用不能な環境では新規開始扱いとする。
    return null;
  }
  const state = parsePersistedState(rawText);
  if (state === null && rawText !== null) {
    // 壊れた/不正なデータは破棄する (Req 16.4)。
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 削除失敗は無視 (復元結果に影響しない)。
    }
  }
  return state;
}

// ============================================================
// 実装
// ============================================================

/**
 * DiagnosisStore の生成オプション。
 * - initial:      復元された回答の初期値 (F-24 連携用)。無効値は取り込まない。
 * - sessionId:    セッション識別子。persist() で保存される (F-24)。
 * - consented:    同意状態の初期値。persist() で保存される (F-24)。省略時 false。
 * - initialIndex: 表示中質問番号の初期値 (F-24 復元用)。範囲外はクランプする。
 */
export interface CreateDiagnosisStoreOptions {
  initial?: Partial<DiagnosisAnswers>;
  sessionId?: string;
  consented?: boolean;
  initialIndex?: number;
}

/**
 * DiagnosisStore を生成する。
 *
 * 内部状態として回答集合 (answers) を保持する。回答集合は
 * `Partial<DiagnosisAnswers>` として扱い、未回答の質問はキーを持たない。
 */
export function createDiagnosisStore(
  options: CreateDiagnosisStoreOptions = {},
): DiagnosisStore {
  // 回答の一時保持。未回答の質問はキーを持たない。
  const answers: Partial<DiagnosisAnswers> = {};

  // 表示中の質問番号 (1-based)。常に [1, TOTAL_QUESTIONS] の範囲に保つ (F-09)。
  let index = clampIndex(options.initialIndex ?? 1);

  // セッション識別子・同意状態 (F-24)。persist() で保存される。
  let sessionId = typeof options.sessionId === "string" ? options.sessionId : "";
  let consented = options.consented === true;

  // 初期値 (復元) があれば、有効な回答値のみ取り込む。
  if (options.initial) {
    for (const [key, value] of Object.entries(options.initial)) {
      if (isValidChoice(value)) {
        answers[key as QuestionId] = value;
      }
    }
  }

  const store: DiagnosisStore = {
    /**
     * setAnswer: 回答を保持する (F-07)。
     *
     * 事後条件:
     *   - choice が "0"〜"4" のとき当該質問IDの保持値を choice へ更新する
     *     (Requirements 5.1, 5.3)
     *   - 同一値での再設定は保持値を変化させない (Requirements 5.2・冪等)
     *   - choice が無効値のときは何もしない。既存の保持値も変更しない
     *     (Requirements 5.4)
     */
    setAnswer(questionId: QuestionId, choice: ChoiceValue): void {
      // "0"〜"4" 以外は受け付けず、保持値を変更しない (Req 5.4)。
      if (!isValidChoice(choice)) {
        return;
      }
      // 同一値の再設定は実質 no-op。異なる有効値なら最新値へ更新 (Req 5.2/5.3)。
      answers[questionId] = choice;
    },

    /**
     * getAnswer: 保持中の回答値を返す。未設定なら undefined。
     */
    getAnswer(questionId: QuestionId): ChoiceValue | undefined {
      return answers[questionId];
    },

    /**
     * progress: 回答済み数・総数・残り数を算出する (F-08)。
     *
     * 回答済みは q1〜q20 のうち値が "0"〜"4" のもののみを数える。
     * 事後条件:
     *   - answered は 0〜TOTAL_QUESTIONS の整数 (Requirements 6.1)
     *   - total === TOTAL_QUESTIONS
     *   - remaining === total - answered (Requirements 6.2)
     */
    progress(): Progress {
      let answered = 0;
      for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
        const id = `q${i}` as QuestionId;
        if (isValidChoice(answers[id])) {
          answered++;
        }
      }
      return {
        answered,
        total: TOTAL_QUESTIONS,
        remaining: TOTAL_QUESTIONS - answered,
      };
    },

    /**
     * validateRequired: 未回答の質問ID一覧を返す (F-10)。
     * engine の純粋関数へ委譲する。
     */
    validateRequired(): QuestionId[] {
      return validateRequired(answers);
    },

    /**
     * gotoNext: 次の質問へ移動する (F-09)。
     *
     * 事後条件:
     *   - 表示中質問番号が 1〜19 のとき +1 する (Requirements 7.1)
     *   - 表示中質問番号が 20 のときは変更しない (Requirements 7.3)
     *   - 回答集合 (answers) は一切変更しない (Requirements 7.5)
     */
    gotoNext(): void {
      if (index < TOTAL_QUESTIONS) {
        index++;
      }
    },

    /**
     * gotoPrev: 前の質問へ移動する (F-09)。
     *
     * 事後条件:
     *   - 表示中質問番号が 2〜20 のとき -1 する (Requirements 7.2)
     *   - 表示中質問番号が 1 のときは変更しない (Requirements 7.4)
     *   - 回答集合 (answers) は一切変更しない (Requirements 7.5)
     */
    gotoPrev(): void {
      if (index > 1) {
        index--;
      }
    },

    /**
     * currentIndex: 現在表示中の質問番号 (1〜20 の整数) を返す (F-09)。
     */
    currentIndex(): number {
      return index;
    },

    /** getSessionId: セッション識別子を返す (F-24)。 */
    getSessionId(): string {
      return sessionId;
    },

    /** isConsented: 同意状態を返す (F-24)。 */
    isConsented(): boolean {
      return consented;
    },

    /** setConsented: 同意状態を設定する (F-24)。 */
    setConsented(next: boolean): void {
      consented = next === true;
    },

    /**
     * persist: 現在状態を localStorage へ保存する (F-24, Req 16.1)。
     *
     * sessionId・回答済みの回答・表示中質問番号・同意状態を一組の PersistedState
     * として書き込み、既存の保存済み状態を上書きする。回答集合は "0"〜"4" の
     * 有効な回答のみを保存する。
     */
    persist(): void {
      const persistedAnswers: Partial<DiagnosisAnswers> = {};
      for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
        const id = `q${i}` as QuestionId;
        const value = answers[id];
        if (isValidChoice(value)) {
          persistedAnswers[id] = value;
        }
      }
      const state: PersistedState = {
        sessionId,
        answers: persistedAnswers,
        currentIndex: index,
        consented,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },

    /**
     * restore: localStorage から状態を復元する (F-24, Req 16.2, 16.4)。
     *
     * 妥当な保存済み状態があれば sessionId・回答・表示中質問番号・同意状態を適用し
     * true を返す。不在/JSON不正/キー欠落/範囲外のときは当該データを破棄し、
     * 現在の新規開始状態を維持したまま false を返す。
     */
    restore(): boolean {
      const state = restorePersistedState();
      if (state === null) {
        return false;
      }
      // 回答を差し替える (既存キーをクリアしてから取り込む)。
      for (const key of Object.keys(answers)) {
        delete answers[key as QuestionId];
      }
      for (const [key, value] of Object.entries(state.answers)) {
        answers[key as QuestionId] = value as ChoiceValue;
      }
      sessionId = state.sessionId;
      index = state.currentIndex;
      consented = state.consented;
      return true;
    },

    /**
     * snapshot: 現在の回答集合のコピーを返す。
     * 内部状態への参照漏れを防ぐため浅いコピーを返す。
     */
    snapshot(): DiagnosisAnswers {
      return { ...answers } as DiagnosisAnswers;
    },
  };

  return store;
}
