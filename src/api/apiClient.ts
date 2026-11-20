/**
 * ApiClient（バックエンド連携 F-03 / F-04 / F-11 / F-14）
 *
 * factor-map-api の API仕様書 (Box: 10_アプリ開発/API仕様書.xlsx) に準拠する。
 *   API-01 POST /api/v1/surveys/pre       利用同意＋事前アンケート (診断IDが発行される)
 *   API-02 POST /api/v1/factor-analyses   20問の回答を送り、採点結果を受け取る
 *   API-03 POST /api/v1/surveys/post      事後アンケート
 *
 * - 画面側には共通の {@link ApiResponse} で返す (成功: data / 失敗: error)
 * - 10 秒でタイムアウトし、通信失敗・HTTP エラーは {@link ErrorHandler} へ通知する (F-20)
 * - テストモード (?test=1) のときは事前アンケートに X-Test-Mode: 1 を付ける
 */

import type { ApiResponse, AppError, DiagnosisAnswers } from "@/models/types";
import { TOTAL_QUESTIONS } from "@/models/types";
import type { ErrorHandler } from "@/api/errorHandler";
import { API_BASE_URL, CLIENT_VERSION, CONSENT_VERSION, isTestMode } from "@/config";
import type { Group } from "@/store/surveyStore";

// ============================================================
// 定数
// ============================================================

/** POST のタイムアウト (ミリ秒) */
export const DEFAULT_TIMEOUT_MS = 10_000;

export const ENDPOINTS = {
  preSurvey: "/api/v1/surveys/pre",
  diagnosis: "/api/v1/factor-analyses",
  postSurvey: "/api/v1/surveys/post",
} as const;

// ============================================================
// 画面側の型 (camelCase)
// ============================================================

export interface PreSurveyRequest {
  frequency: number;
  explain: number;
  relation: number;
  causes: number[];
  ageGroup?: string;
}

export interface PreSurveyResponse {
  diagnosisId: string;
  group: Group;
  /** true なら本番データではない (テストモード) */
  isTest: boolean;
}

export interface DiagnosisRequest {
  diagnosisId: string;
  /** 診断20問の回答 (q1〜q20、"0"〜"4") */
  answers: DiagnosisAnswers;
}

/** 順位つきの分類 (rank は 1 始まり) */
export interface RankedCategory {
  rank: number;
  category_id: number;
  score: number;
}

/**
 * API-02 のレスポンス (バックエンドの形のまま。API仕様書 0.3「API-02 診断」)。
 *
 * 表示ルールはバックエンド (factor-map-api の scoring.py) が決める。画面では計算しない。
 *   - circles        : 円に出す分類。点数の高い順に最大5つ、20点未満は出さない (タイプの分類は必ず出す)
 *   - type_categories: タイプの分類。1位の85%以上かつ50点以上、最大3つ。
 *                      1位が50点未満 (low_moyamoya) は1位の1つ、全部0点なら空
 *   - links          : タイプの分類どうしの組 (2つなら1本、3つなら3本)
 */
export interface FactorAnalysisResponse {
  diagnosis_id: string;
  scoring_version: string;
  /** 10分類すべての点数 (分類ID順) */
  scores: { category_id: number; score: number }[];
  /** 円に出す分類 (順位順、0〜5件) */
  circles: RankedCategory[];
  /** タイプの分類 (順位順、0〜3件) */
  type_categories: RankedCategory[];
  /** 1位の分類。全部0点のときだけ null */
  main_category_id: number | null;
  /** タイプID。分類IDを小さい順に2桁でつないだもの ("05" / "03-09" / "03-05-09")。全部0点なら null */
  result_type_id: string | null;
  /** 1位でも50点未満。true でもタイプ (1つ) は返る */
  low_moyamoya: boolean;
  /** 線でつなぐタイプの分類の組 */
  links: { from: number; to: number }[];
}

export interface PostSurveyRequest {
  diagnosisId: string;
  explain: number;
  relation: number;
  /** A群のみ */
  fit?: number;
  /** A群のみ */
  discovery?: number;
  comment?: string;
}

export interface PostSurveyResponse {
  diagnosisId: string;
}

// ============================================================
// 変換 (純粋関数・テスト対象)
// ============================================================

/** 画面の回答 (q1:"0"〜"4") を API の形 (q01:1〜5) に変える。欠けがあれば null */
export function toApiAnswers(answers: DiagnosisAnswers): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
    const raw = answers[`q${i}`];
    const n = Number(raw);
    if (raw === undefined || !Number.isInteger(n) || n < 0 || n > 4) return null;
    out[`q${String(i).padStart(2, "0")}`] = n + 1;
  }
  return out;
}

/** API のエラー項目名 (pre_explain など) を画面の項目名 (explain など) に変える */
export function toViewField(apiField: string | undefined): string | undefined {
  if (!apiField) return undefined;
  const special: Record<string, string> = {
    pre_frequency: "frequency",
    pre_causes: "causes",
    age_group: "ageGroup",
    post_fit: "fit",
    post_discovery: "discovery",
    post_comment: "comment",
  };
  if (special[apiField]) return special[apiField];
  return apiField.replace(/^(pre|post)_/, "");
}

// ============================================================
// 注入可能な依存 (テスト容易性)
// ============================================================

export type FetchFn = typeof fetch;

export interface ApiClientOptions {
  /** 接続先 (既定: config の API_BASE_URL) */
  baseUrl?: string;
  /** エラー通知先 (F-20) */
  errorHandler: ErrorHandler;
  /** fetch 実装 (既定: グローバル fetch) */
  fetchFn?: FetchFn;
  /** タイムアウト ms (既定: 10 秒) */
  timeoutMs?: number;
  /** テストモードか (既定: config の isTestMode) */
  isTestMode?: () => boolean;
}

export interface ApiClient {
  postPreSurvey(req: PreSurveyRequest): Promise<ApiResponse<PreSurveyResponse>>;
  postDiagnosis(req: DiagnosisRequest): Promise<ApiResponse<FactorAnalysisResponse>>;
  postPostSurvey(req: PostSurveyRequest): Promise<ApiResponse<PostSurveyResponse>>;
}

// ============================================================
// 実装
// ============================================================

function preconditionError<T>(fields: string[]): ApiResponse<T> {
  return {
    ok: false,
    error: { code: "PRECONDITION", message: "入力内容を確認してください", fields },
  };
}

function isNonEmpty(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

class ApiClientImpl implements ApiClient {
  private readonly baseUrl: string;
  private readonly errorHandler: ErrorHandler;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly testMode: () => boolean;

  constructor(options: ApiClientOptions) {
    this.baseUrl = (options.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
    this.errorHandler = options.errorHandler;
    this.fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.testMode = options.isTestMode ?? isTestMode;
  }

  async postPreSurvey(req: PreSurveyRequest): Promise<ApiResponse<PreSurveyResponse>> {
    const headers: Record<string, string> = {};
    if (this.testMode()) headers["X-Test-Mode"] = "1";
    const res = await this.post<{ diagnosis_id: string; group: Group; is_test: boolean }>(
      ENDPOINTS.preSurvey,
      {
        consent: true,
        consent_version: CONSENT_VERSION,
        client_version: CLIENT_VERSION,
        pre_frequency: req.frequency,
        pre_explain: req.explain,
        pre_relation: req.relation,
        pre_causes: req.causes,
        age_group: req.ageGroup ?? null,
      },
      headers
    );
    if (!res.ok) return res;
    return {
      ok: true,
      data: { diagnosisId: res.data.diagnosis_id, group: res.data.group, isTest: res.data.is_test },
    };
  }

  async postDiagnosis(req: DiagnosisRequest): Promise<ApiResponse<FactorAnalysisResponse>> {
    if (!isNonEmpty(req.diagnosisId)) return preconditionError(["diagnosisId"]);
    const answers = toApiAnswers(req.answers);
    if (answers === null) return preconditionError(["answers"]);
    return this.post<FactorAnalysisResponse>(ENDPOINTS.diagnosis, {
      diagnosis_id: req.diagnosisId,
      answers,
    });
  }

  async postPostSurvey(req: PostSurveyRequest): Promise<ApiResponse<PostSurveyResponse>> {
    if (!isNonEmpty(req.diagnosisId)) return preconditionError(["diagnosisId"]);
    const body: Record<string, unknown> = {
      diagnosis_id: req.diagnosisId,
      post_explain: req.explain,
      post_relation: req.relation,
      post_comment: req.comment?.trim() ? req.comment.trim() : null,
    };
    if (req.fit !== undefined) body.post_fit = req.fit;
    if (req.discovery !== undefined) body.post_discovery = req.discovery;
    const res = await this.post<{ diagnosis_id: string }>(ENDPOINTS.postSurvey, body);
    if (!res.ok) return res;
    return { ok: true, data: { diagnosisId: res.data.diagnosis_id } };
  }

  /**
   * 共通 POST。成功時はレスポンス JSON を data に入れて返す。
   * HTTP エラーはバックエンドの {"error": {code, message, field}} を ApiResponse の error に変える。
   */
  private async post<T>(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const error: AppError = { kind: "server", status: res.status, retryable: res.status >= 500 };
        this.errorHandler.notify(error);
        return await parseError<T>(res);
      }
      return { ok: true, data: (await res.json()) as T };
    } catch (cause) {
      this.errorHandler.notify({ kind: "network", retryable: true });
      return {
        ok: false,
        error: {
          code: isAbortError(cause) ? "TIMEOUT" : "NETWORK",
          message: "通信に失敗しました。再試行してください",
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseError<T>(res: Response): Promise<ApiResponse<T>> {
  try {
    const json = (await res.json()) as { error?: { code?: string; message?: string; field?: string } };
    if (json?.error?.code) {
      const field = toViewField(json.error.field);
      return {
        ok: false,
        error: {
          code: json.error.code,
          message: json.error.message ?? "エラーが発生しました",
          fields: field ? [field] : undefined,
        },
      };
    }
  } catch {
    // JSON でない応答はフォールバックへ
  }
  return { ok: false, error: { code: `HTTP_${res.status}`, message: "サーバエラーが発生しました" } };
}

function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClientImpl(options);
}
