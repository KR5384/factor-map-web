/**
 * ApiClient（バックエンド連携 F-04 / F-11 / F-14）
 *
 * design.md Component 4 および「API設計」節に準拠する。
 * 研究データ保存用の3つの POST を担い、送信前提条件ガードと 10 秒タイムアウトを備え、
 * 通信失敗・タイムアウトは {@link ErrorHandler} へ委譲する (F-20)。
 *
 * 送信前提条件 (Req 14):
 *   - sessionId が空文字列または未設定なら送信せず Store 状態を変更しない (Req 14.1, 14.2, 9.9)
 *   - アンケートの clarity / conviction が 1〜5 の整数でないなら送信しない (Req 14.3, 14.4, 4.3, 4.4, 12.3, 12.4)
 *
 * タイムアウト (Req 15.1):
 *   - 10 秒以内に応答が無ければ AbortController で中断し、network エラーとして ErrorHandler へ委譲する
 *
 * 返り値はすべて共通レスポンス型 {@link ApiResponse}。送信前提条件を満たさない場合は
 * ok: false の validation エラーを返し、Workers_Api への送信は行わない。
 */

import type {
  ApiResponse,
  AppError,
  DiagnosisAnswers,
  DiagnosisResult,
} from "@/models/types";
import { isValidScale } from "@/store/surveyStore";
import type { ErrorHandler } from "@/api/errorHandler";

// ============================================================
// 定数・設定
// ============================================================

/** 既存 Worker のベースURL (design.md「API設計」) */
export const DEFAULT_BASE_URL = "https://factor-map-api.east-10g.workers.dev";

/** POST のタイムアウト (ミリ秒)。10 秒 (Req 15.1) */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** エンドポイントパス */
export const ENDPOINTS = {
  preSurvey: "/api/pre-survey",
  diagnosis: "/api/diagnosis",
  postSurvey: "/api/post-survey",
} as const;

// ============================================================
// リクエスト / レスポンス型 (design.md「API設計」)
// ============================================================

/** 事前アンケート保存リクエスト (F-04) */
export interface PreSurveyRequest {
  sessionId: string;
  /** もやもや整理度 1..5 */
  clarity: number;
  /** 自由記述 (任意) */
  freeText?: string;
}

/** 事前アンケート保存レスポンス (F-04) */
export interface PreSurveyResponse {
  preSurveyId: string;
}

/** 診断結果保存リクエスト (F-11) */
export interface DiagnosisRequest {
  sessionId: string;
  answers: DiagnosisAnswers;
  result: DiagnosisResult;
}

/** 診断結果保存レスポンス (F-11) */
export interface DiagnosisResponse {
  diagnosisId: string;
}

/** 事後アンケート保存リクエスト (F-14) */
export interface PostSurveyRequest {
  sessionId: string;
  /** もやもや整理度 1..5 */
  clarity: number;
  /** 納得度 1..5 */
  conviction: number;
  /** 自由記述 (任意) */
  freeText?: string;
}

/** 事後アンケート保存レスポンス (F-14) */
export interface PostSurveyResponse {
  postSurveyId: string;
}

// ============================================================
// 注入可能な依存 (テスト容易性)
// ============================================================

/** fetch 実装。テストで差し替え可能にする。既定はグローバル fetch */
export type FetchFn = typeof fetch;

/**
 * タイムアウト制御。既定は AbortController + setTimeout による 10 秒制限。
 * テストでは即時タイムアウトや無効化が行えるよう注入可能にする。
 */
export type TimeoutController = {
  /** 中断シグナル。fetch の signal に渡す */
  signal: AbortSignal;
  /** タイマー解除 (fetch 完了時に呼ぶ) */
  clear(): void;
};

/** TimeoutController のファクトリ */
export type TimeoutFactory = (timeoutMs: number) => TimeoutController;

/** 既定の TimeoutController ファクトリ (AbortController ベース) */
export const defaultTimeoutFactory: TimeoutFactory = (timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
};

export interface ApiClientOptions {
  /** ベースURL (既定: DEFAULT_BASE_URL) */
  baseUrl?: string;
  /** エラー委譲先 (F-20)。通信失敗・タイムアウト・サーバエラー時に notify される */
  errorHandler: ErrorHandler;
  /** fetch 実装 (既定: グローバル fetch) */
  fetchFn?: FetchFn;
  /** タイムアウト ms (既定: DEFAULT_TIMEOUT_MS = 10 秒) */
  timeoutMs?: number;
  /** TimeoutController ファクトリ (既定: AbortController ベース) */
  timeoutFactory?: TimeoutFactory;
}

// ============================================================
// ApiClient インターフェース
// ============================================================

export interface ApiClient {
  /** 事前アンケートを POST する (F-04) */
  postPreSurvey(
    req: PreSurveyRequest
  ): Promise<ApiResponse<PreSurveyResponse>>;
  /** 診断結果を POST する (F-11) */
  postDiagnosis(
    req: DiagnosisRequest
  ): Promise<ApiResponse<DiagnosisResponse>>;
  /** 事後アンケートを POST する (F-14) */
  postPostSurvey(
    req: PostSurveyRequest
  ): Promise<ApiResponse<PostSurveyResponse>>;
}

// ============================================================
// 前提条件ガード (純粋関数)
// ============================================================

/**
 * sessionId が送信可能な非空値かを判定する (Req 14.1, 14.2, 9.9)。
 * null/undefined・空文字・空白のみはすべて不可とする。
 */
export function isNonEmptySessionId(
  sessionId: string | undefined | null
): sessionId is string {
  return typeof sessionId === "string" && sessionId.trim().length > 0;
}

/** 送信前提条件エラー (ok: false の validation) を生成する */
function preconditionError<T>(fields: string[]): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code: "PRECONDITION",
      message: "送信前提条件を満たしていません",
      fields,
    },
  };
}

// ============================================================
// 実装
// ============================================================

class ApiClientImpl implements ApiClient {
  private readonly baseUrl: string;
  private readonly errorHandler: ErrorHandler;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly timeoutFactory: TimeoutFactory;

  constructor(options: ApiClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.errorHandler = options.errorHandler;
    this.fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.timeoutFactory = options.timeoutFactory ?? defaultTimeoutFactory;
  }

  async postPreSurvey(
    req: PreSurveyRequest
  ): Promise<ApiResponse<PreSurveyResponse>> {
    // Req 14.2 / 9.9: sessionId 空/未設定なら送信せず Store 状態を変更しない
    if (!isNonEmptySessionId(req.sessionId)) {
      return preconditionError<PreSurveyResponse>(["sessionId"]);
    }
    // Req 14.3 / 14.4 / 4.3 / 4.4: clarity が 1〜5 の整数でなければ送信しない
    if (!isValidScale(req.clarity)) {
      return preconditionError<PreSurveyResponse>(["clarity"]);
    }
    return this.post<PreSurveyResponse>(ENDPOINTS.preSurvey, {
      sessionId: req.sessionId,
      clarity: req.clarity,
      freeText: req.freeText,
    });
  }

  async postDiagnosis(
    req: DiagnosisRequest
  ): Promise<ApiResponse<DiagnosisResponse>> {
    // Req 14.2 / 9.9: sessionId 空/未設定なら送信せず Store 状態を変更しない
    if (!isNonEmptySessionId(req.sessionId)) {
      return preconditionError<DiagnosisResponse>(["sessionId"]);
    }
    return this.post<DiagnosisResponse>(ENDPOINTS.diagnosis, {
      sessionId: req.sessionId,
      answers: req.answers,
      result: req.result,
    });
  }

  async postPostSurvey(
    req: PostSurveyRequest
  ): Promise<ApiResponse<PostSurveyResponse>> {
    // Req 14.2 / 9.9: sessionId 空/未設定なら送信せず Store 状態を変更しない
    if (!isNonEmptySessionId(req.sessionId)) {
      return preconditionError<PostSurveyResponse>(["sessionId"]);
    }
    // Req 14.3 / 14.4 / 12.3 / 12.4: clarity・conviction が 1〜5 の整数でなければ送信しない
    const invalid: string[] = [];
    if (!isValidScale(req.clarity)) invalid.push("clarity");
    if (!isValidScale(req.conviction)) invalid.push("conviction");
    if (invalid.length > 0) {
      return preconditionError<PostSurveyResponse>(invalid);
    }
    return this.post<PostSurveyResponse>(ENDPOINTS.postSurvey, {
      sessionId: req.sessionId,
      clarity: req.clarity,
      conviction: req.conviction,
      freeText: req.freeText,
    });
  }

  /**
   * 共通 POST 処理。
   * - 10 秒タイムアウトを AbortController で制御 (Req 15.1)
   * - 通信失敗・タイムアウト → network エラーを ErrorHandler へ委譲
   * - HTTP エラー (4xx/5xx) → server エラーを ErrorHandler へ委譲
   * - 成功時は Worker の ApiResponse<T> JSON をそのまま返す
   */
  private async post<T>(
    path: string,
    body: unknown
  ): Promise<ApiResponse<T>> {
    const timeout = this.timeoutFactory(this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: timeout.signal,
      });

      if (!res.ok) {
        // HTTP エラー応答 (400/404/500 等) は server エラーとして委譲 (Req 15.2, 15.4, 15.5)
        const error: AppError = {
          kind: "server",
          status: res.status,
          // 500 系はリトライ可、4xx はリトライ不可 (ErrorHandler 側で 400/404 を個別処理)
          retryable: res.status >= 500,
        };
        this.errorHandler.notify(error);
        return this.parseBodySafely<T>(res, error);
      }

      // 成功: Worker の ApiResponse<T> をそのまま返す
      return (await res.json()) as ApiResponse<T>;
    } catch (cause) {
      // fetch 失敗 or タイムアウト (AbortError) → network エラーとして委譲 (Req 15.1)
      const error: AppError = { kind: "network", retryable: true };
      this.errorHandler.notify(error);
      return {
        ok: false,
        error: {
          code: isAbortError(cause) ? "TIMEOUT" : "NETWORK",
          message: "通信に失敗しました。再試行してください",
        },
      };
    } finally {
      timeout.clear();
    }
  }

  /**
   * HTTP エラー応答のボディを可能なら ApiResponse として解釈する。
   * JSON でない/解釈失敗時は、HTTP ステータスから最低限のエラーを構築する。
   */
  private async parseBodySafely<T>(
    res: Response,
    fallback: Extract<AppError, { kind: "server" }>
  ): Promise<ApiResponse<T>> {
    try {
      const json = (await res.json()) as ApiResponse<T>;
      if (json && typeof json === "object" && "ok" in json) {
        return json;
      }
    } catch {
      // ボディが JSON でない場合はフォールバックへ
    }
    return {
      ok: false,
      error: {
        code: `HTTP_${fallback.status}`,
        message: "サーバエラーが発生しました",
      },
    };
  }
}

/** AbortController による中断 (タイムアウト) かを判定する */
function isAbortError(cause: unknown): boolean {
  return (
    cause instanceof DOMException && cause.name === "AbortError"
  ) ||
    (typeof cause === "object" &&
      cause !== null &&
      "name" in cause &&
      (cause as { name?: unknown }).name === "AbortError");
}

/** ApiClient を生成する */
export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClientImpl(options);
}
