/**
 * ErrorHandler（共通エラー処理 F-20）
 *
 * design.md Component 6 および「Error Handling」節に準拠する。
 * network / validation / server の {@link AppError} を利用者向け通知へ変換し、
 * 指数バックオフ（初回1秒・以後2倍・最大3回）によるリトライ制御を担う。
 *
 * - 400 入力不正: 対象フィールドを強調し、自動リトライを行わず修正・再送信を促す (Req 15.4)
 * - 404 セッション未検出: セッション再生成を提案し、新規 sessionId を発行して再送可能にする (Req 15.5)
 * - 500 / 通信失敗: リトライ手段を提示し、最大3回まで指数バックオフで再送する (Req 15.1, 15.2)
 * - 最大3回のリトライがすべて失敗: 保存失敗を通知し、回答は保持したまま表示継続を可能にする (Req 15.3)
 */

import type { AppError } from "@/models/types.ts";

// ============================================================
// 定数・設定
// ============================================================

/** 最大リトライ回数 (Req 15.1, 15.2, 15.3) */
export const MAX_RETRIES = 3;

/** 初回リトライ待機時間 (ミリ秒)。以後は 2 倍ずつ (Req 15.1) */
export const INITIAL_BACKOFF_MS = 1000;

/** バックオフの倍率 (各リトライごとに待機を 2 倍) */
export const BACKOFF_FACTOR = 2;

// ============================================================
// 通知モデル
// ============================================================

/** 利用者向け通知の種別 */
export type NotificationKind = "network" | "validation" | "server";

/** 利用者が取り得る回復アクション */
export type RecoveryAction =
  /** リトライ手段を提示する (通信失敗 / 500) */
  | "retry"
  /** 対象フィールドの強調表示で修正を促す (400) */
  | "highlightFields"
  /** セッション再生成を提案する (404) */
  | "regenerateSession";

/**
 * 利用者向け通知。View 層がこの構造を解釈して UI を提示する。
 */
export interface UserNotification {
  kind: NotificationKind;
  /** 利用者向けメッセージ */
  message: string;
  /** 利用者に提示すべき回復アクション */
  recovery: RecoveryAction;
  /** 自動リトライ可能か (400 は false) */
  retryable: boolean;
  /** 強調表示すべきフィールド名 (validation 時のみ) */
  fields?: string[];
  /** HTTP ステータス (server 時のみ) */
  status?: number;
}

/** 通知を利用者へ提示するシンク。UI 層で差し替え可能 */
export type NotificationSink = (notification: UserNotification) => void;

/**
 * 待機関数。テストで待機を即時化できるよう注入可能にする。
 * 既定は実時間の setTimeout。
 */
export type Sleep = (ms: number) => Promise<void>;

/** 既定の待機実装 (実時間で待機) */
export const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================
// ErrorHandler インターフェース
// ============================================================

/** リトライ対象の操作。成功時 true、失敗時 false を返す (または reject) */
export type RetryableOperation = () => Promise<boolean>;

export interface ErrorHandler {
  /** AppError を利用者向け通知へ変換して通知する */
  notify(error: AppError): UserNotification;

  /**
   * 指数バックオフで操作をリトライする (初回1秒・以後2倍・最大3回)。
   * - 操作が true を返した時点で成功とし、結果 succeeded: true を返す
   * - 最大回数まで失敗したら succeeded: false を返す (回答は呼び出し側で保持)
   */
  retryWithBackoff(operation: RetryableOperation): Promise<RetryOutcome>;

  /** n 回目 (0 起点) のリトライ前に待機すべきミリ秒を返す */
  backoffDelayMs(attempt: number): number;
}

/** リトライ結果 */
export interface RetryOutcome {
  /** いずれかの試行で成功したか */
  succeeded: boolean;
  /** 実行した試行回数 (1〜MAX_RETRIES) */
  attempts: number;
}

// ============================================================
// 実装
// ============================================================

export interface ErrorHandlerOptions {
  /** 通知の提示先 (既定: console.error へのフォールバック) */
  sink?: NotificationSink;
  /** 待機関数 (既定: 実時間の setTimeout)。テストで即時化するため注入可能 */
  sleep?: Sleep;
  /** 最大リトライ回数 (既定: MAX_RETRIES) */
  maxRetries?: number;
  /** 初回バックオフ待機時間 ms (既定: INITIAL_BACKOFF_MS) */
  initialBackoffMs?: number;
  /** バックオフ倍率 (既定: BACKOFF_FACTOR) */
  backoffFactor?: number;
}

/** 利用者向けメッセージ (design.md「Error Handling」のメッセージ方針に準拠) */
const MESSAGES = {
  network: "通信に失敗しました。再試行してください",
  server: "保存に失敗しました",
  validation: "入力内容を確認してください",
  retryExhausted:
    "保存に失敗しました。回答は保持しています。診断結果の表示は続けられます",
  sessionNotFound: "セッションが見つかりませんでした。再生成して再試行できます",
} as const;

class DefaultErrorHandler implements ErrorHandler {
  private readonly sink: NotificationSink;
  private readonly sleep: Sleep;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly backoffFactor: number;

  constructor(options: ErrorHandlerOptions = {}) {
    this.sink =
      options.sink ??
      ((notification) => {
        // 既定のフォールバック。UI 層が未配線でも通知内容を失わない。
        console.error("[ErrorHandler]", notification.message, notification);
      });
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.initialBackoffMs = options.initialBackoffMs ?? INITIAL_BACKOFF_MS;
    this.backoffFactor = options.backoffFactor ?? BACKOFF_FACTOR;
  }

  notify(error: AppError): UserNotification {
    const notification = toNotification(error);
    this.sink(notification);
    return notification;
  }

  backoffDelayMs(attempt: number): number {
    // attempt 0 → initial, attempt 1 → initial*factor, ...
    return this.initialBackoffMs * Math.pow(this.backoffFactor, attempt);
  }

  async retryWithBackoff(
    operation: RetryableOperation
  ): Promise<RetryOutcome> {
    let attempts = 0;
    for (let i = 0; i < this.maxRetries; i++) {
      // 初回を含め、各試行の前に指数バックオフで待機する (初回1秒・以後2倍)。
      await this.sleep(this.backoffDelayMs(i));
      attempts = i + 1;
      let ok = false;
      try {
        ok = await operation();
      } catch {
        ok = false;
      }
      if (ok) {
        return { succeeded: true, attempts };
      }
    }
    // Req 15.3: 最大回数すべて失敗 → 保存失敗を通知 (回答保持・表示継続は呼び出し側)
    this.sink({
      kind: "server",
      message: MESSAGES.retryExhausted,
      recovery: "retry",
      retryable: false,
    });
    return { succeeded: false, attempts };
  }
}

/**
 * AppError を利用者向け通知へ変換する純粋関数。
 * ステータスに応じて回復アクションを決定する。
 */
export function toNotification(error: AppError): UserNotification {
  switch (error.kind) {
    case "network":
      // Req 15.1: 通信失敗 → リトライ手段を提示
      return {
        kind: "network",
        message: MESSAGES.network,
        recovery: "retry",
        retryable: true,
      };

    case "validation":
      // Req 15.4: 400 入力不正 → フィールド強調・自動リトライなし
      return {
        kind: "validation",
        message: MESSAGES.validation,
        recovery: "highlightFields",
        retryable: false,
        fields: error.fields,
      };

    case "server": {
      if (error.status === 404) {
        // Req 15.5: セッション未検出 → セッション再生成を提案
        return {
          kind: "server",
          message: MESSAGES.sessionNotFound,
          recovery: "regenerateSession",
          retryable: false,
          status: 404,
        };
      }
      if (error.status === 400) {
        // 400 が server として届いた場合もフィールド強調・リトライなし (Req 15.4)
        return {
          kind: "validation",
          message: MESSAGES.validation,
          recovery: "highlightFields",
          retryable: false,
          status: 400,
        };
      }
      // Req 15.2: 500 (およびその他のサーバエラー) → リトライ手段を提示
      return {
        kind: "server",
        message: MESSAGES.server,
        recovery: "retry",
        retryable: error.retryable,
        status: error.status,
      };
    }
  }
}

/**
 * 新規 sessionId を発行する (Req 15.5)。
 * 404 セッション未検出時のセッション再生成提案に用いる。非空の UUID を返す。
 */
export function regenerateSessionId(): string {
  return crypto.randomUUID();
}

/** ErrorHandler を生成する */
export function createErrorHandler(
  options: ErrorHandlerOptions = {}
): ErrorHandler {
  return new DefaultErrorHandler(options);
}
