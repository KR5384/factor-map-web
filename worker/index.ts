/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Workers API: もやもや診断アプリ バックエンド
 *
 * 研究データ保存用の3つの POST エンドポイントを提供する (API バージョン: v1)。
 *   - POST /api/v1/surveys/pre        事前アンケート保存 (F-04 / Requirements 4.5, 4.6)
 *   - POST /api/v1/factor-analyses    診断結果保存       (F-11 / Requirements 9.7, 9.8)
 *   - POST /api/v1/surveys/post       事後アンケート保存 (F-14 / Requirements 12.5, 12.6)
 *
 * 参照: design.md「API設計」。D1 へ prepared statement で永続化する。
 *
 * NOTE: このファイルは Worker 専用バンドルのため、src/ からは import せず、
 *       契約 (ApiResponse など) をローカル定義で自己完結させる。
 */

// ============================================================
// 環境バインディング
// ============================================================

/** wrangler.toml の [[d1_databases]] binding = "DB" に対応 */
export interface Env {
  DB: D1Database;

  // --- 管理者機能 (F-19 / Requirements 21) 用の資格情報 ---
  // wrangler.toml の [vars] で開発用プレースホルダを定義し、
  // 本番は `wrangler secret put` で上書きすることを想定する。
  // ユーザ名+パスワード、または単一トークンのいずれかで認証できる。
  ADMIN_USER?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_TOKEN?: string;
}

// ============================================================
// 共通レスポンス型 (design.md「API設計」と整合)
// ============================================================

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fields?: string[] } };

interface PreSurveyRequest {
  sessionId?: unknown;
  clarity?: unknown;
  freeText?: unknown;
}

interface DiagnosisRequest {
  sessionId?: unknown;
  answers?: unknown;
  result?: unknown;
}

interface PostSurveyRequest {
  sessionId?: unknown;
  clarity?: unknown;
  conviction?: unknown;
  freeText?: unknown;
}

// ============================================================
// 定数
// ============================================================

const SURVEY_SCALE_MIN = 1;
const SURVEY_SCALE_MAX = 5;
const FREE_TEXT_MAX_LENGTH = 1000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

// ============================================================
// レスポンスヘルパ
// ============================================================

function json<T>(body: ApiResponse<T>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function ok<T>(data: T): Response {
  return json<T>({ ok: true, data }, 200);
}

function validationError(message: string, fields?: string[]): Response {
  return json(
    { ok: false, error: { code: "VALIDATION", message, fields } },
    400,
  );
}

function sessionNotFound(): Response {
  return json(
    {
      ok: false,
      error: {
        code: "SESSION_NOT_FOUND",
        message: "指定されたセッションが見つかりません",
      },
    },
    404,
  );
}

function serverError(message = "保存に失敗しました"): Response {
  return json(
    { ok: false, error: { code: "SERVER_ERROR", message } },
    500,
  );
}

/** 認証が必要 / 認証失敗 (Requirements 18.3, 19.3, 20.3, 21.1) */
function authRequired(message = "認証が必要です"): Response {
  return json(
    { ok: false, error: { code: "AUTH_REQUIRED", message } },
    401,
  );
}

/** ロック中 (Requirements 21.4) */
function lockedResponse(message = "試行回数の上限に達しました。しばらくしてから再試行してください"): Response {
  return json(
    { ok: false, error: { code: "LOCKED", message } },
    429,
  );
}

// ============================================================
// バリデーションヘルパ
// ============================================================

/** 非空文字列か */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** clarity/conviction が 1〜5 の整数か */
function isValidScale(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= SURVEY_SCALE_MIN &&
    v <= SURVEY_SCALE_MAX
  );
}

/** 自由記述が未指定または 1000 文字以内の文字列か */
function isValidFreeText(v: unknown): v is string | undefined | null {
  if (v === undefined || v === null) return true;
  return typeof v === "string" && v.length <= FREE_TEXT_MAX_LENGTH;
}

/** 自由記述を保存用の文字列 or null へ正規化 */
function normalizeFreeText(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** リクエストボディを JSON として安全にパースする */
async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** sessions テーブルに sessionId が存在するか */
async function sessionExists(env: Env, sessionId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<{ id: string }>();
  return row !== null;
}

// ============================================================
// エンドポイント: POST /api/v1/surveys/pre (Requirements 4.5, 4.6)
// ============================================================

async function handlePreSurvey(request: Request, env: Env): Promise<Response> {
  const body = (await parseJsonBody(request)) as PreSurveyRequest | undefined;
  if (body === undefined || typeof body !== "object") {
    return validationError("リクエストボディが不正です");
  }

  // 入力検証: sessionId 非空・clarity 1〜5・freeText 1000 文字以内
  if (!isNonEmptyString(body.sessionId)) {
    return validationError("sessionId が指定されていません", ["sessionId"]);
  }
  if (!isValidScale(body.clarity)) {
    return validationError("clarityは1〜5で指定してください", ["clarity"]);
  }
  if (!isValidFreeText(body.freeText)) {
    return validationError("freeTextは1000文字以内で指定してください", [
      "freeText",
    ]);
  }

  // セッション存在検証 (4.5)。未検出時は 404 で保存しない (4.6)
  let exists: boolean;
  try {
    exists = await sessionExists(env, body.sessionId);
  } catch {
    return serverError();
  }
  if (!exists) {
    return sessionNotFound();
  }

  // 検証を全て満たす場合に限り INSERT (4.5)
  const preSurveyId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO pre_survey (id, session_id, clarity, free_text) VALUES (?, ?, ?, ?)",
    )
      .bind(
        preSurveyId,
        body.sessionId,
        body.clarity,
        normalizeFreeText(body.freeText),
      )
      .run();
  } catch {
    return serverError();
  }

  return ok({ preSurveyId });
}

// ============================================================
// エンドポイント: POST /api/v1/factor-analyses (Requirements 9.7, 9.8)
// ============================================================

async function handleDiagnosis(request: Request, env: Env): Promise<Response> {
  const body = (await parseJsonBody(request)) as DiagnosisRequest | undefined;
  if (body === undefined || typeof body !== "object") {
    return validationError("リクエストボディが不正です");
  }

  // 診断結果の検証は最小限 (spec): sessionId の存在確認のみ。
  if (!isNonEmptyString(body.sessionId)) {
    return validationError("sessionId が指定されていません", ["sessionId"]);
  }
  if (body.answers === undefined || body.answers === null) {
    return validationError("answers が指定されていません", ["answers"]);
  }
  if (body.result === undefined || body.result === null) {
    return validationError("result が指定されていません", ["result"]);
  }

  // top_factor は集計の便宜のため result から取り出す (存在しなければ空文字)
  const topFactor =
    typeof body.result === "object" &&
    body.result !== null &&
    "topFactorId" in body.result &&
    typeof (body.result as { topFactorId: unknown }).topFactorId === "string"
      ? (body.result as { topFactorId: string }).topFactorId
      : "";

  const diagnosisId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO diagnosis (id, session_id, answers_json, result_json, top_factor) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        diagnosisId,
        body.sessionId,
        JSON.stringify(body.answers),
        JSON.stringify(body.result),
        topFactor,
      )
      .run();
  } catch {
    // 保存失敗時は 500 SERVER_ERROR (9.8)
    return serverError();
  }

  return ok({ diagnosisId });
}

// ============================================================
// エンドポイント: POST /api/v1/surveys/post (Requirements 12.5, 12.6)
// ============================================================

async function handlePostSurvey(request: Request, env: Env): Promise<Response> {
  const body = (await parseJsonBody(request)) as PostSurveyRequest | undefined;
  if (body === undefined || typeof body !== "object") {
    return validationError("リクエストボディが不正です");
  }

  // 入力検証: sessionId 非空・clarity 1〜5・conviction 1〜5・freeText 1000 文字以内
  if (!isNonEmptyString(body.sessionId)) {
    return validationError("sessionId が指定されていません", ["sessionId"]);
  }
  if (!isValidScale(body.clarity)) {
    return validationError("clarityは1〜5で指定してください", ["clarity"]);
  }
  if (!isValidScale(body.conviction)) {
    return validationError("convictionは1〜5で指定してください", [
      "conviction",
    ]);
  }
  if (!isValidFreeText(body.freeText)) {
    return validationError("freeTextは1000文字以内で指定してください", [
      "freeText",
    ]);
  }

  // セッション存在検証 (12.5)。未検出時は 404 で保存しない (12.6)
  let exists: boolean;
  try {
    exists = await sessionExists(env, body.sessionId);
  } catch {
    return serverError();
  }
  if (!exists) {
    return sessionNotFound();
  }

  // 検証を全て満たす場合に限り INSERT (12.5)
  const postSurveyId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO post_survey (id, session_id, clarity, conviction, free_text) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        postSurveyId,
        body.sessionId,
        body.clarity,
        body.conviction,
        normalizeFreeText(body.freeText),
      )
      .run();
  } catch {
    return serverError();
  }

  return ok({ postSurveyId });
}

// ============================================================
// 管理者認証 (F-19 / Requirements 21)
// ============================================================

/** ログイン要求ボディ */
interface AdminLoginRequest {
  username?: unknown;
  password?: unknown;
  token?: unknown;
}

const ADMIN_MAX_FAILURES = 5; // 連続失敗の上限 (21.4)
const ADMIN_LOCK_MS = 60_000; // ロック時間 60 秒 (21.4)

/**
 * 要求元ごとの連続失敗回数とロック解除時刻を保持する。
 *
 * NOTE: このインメモリ Map は Worker の isolate 単位でしか共有されず、
 *       isolate の再生成やリージョン分散で失われる/分裂する可能性がある。
 *       厳密な分散レート制限が必要な場合は Durable Objects や KV へ移行する。
 *       本実装では要件の「連続5回失敗で60秒ロック」を単一 isolate 内で満たす。
 */
interface FailureState {
  count: number;
  lockedUntil: number; // epoch ms。0 はロックなし
}
const adminFailures = new Map<string, FailureState>();

/** 要求元を識別するキー (CF-Connecting-IP を優先) */
function requesterKey(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown"
  );
}

/** 現在ロック中か (ロック期限切れなら状態をリセット) */
function isLocked(key: string, now: number): boolean {
  const state = adminFailures.get(key);
  if (!state) return false;
  if (state.lockedUntil > now) return true;
  // ロック期限が過ぎていれば失敗カウントをクリアする
  if (state.lockedUntil !== 0) {
    adminFailures.delete(key);
  }
  return false;
}

/** 認証失敗を記録し、上限到達でロックする (21.4) */
function recordFailure(key: string, now: number): void {
  const state = adminFailures.get(key) ?? { count: 0, lockedUntil: 0 };
  state.count += 1;
  if (state.count >= ADMIN_MAX_FAILURES) {
    state.lockedUntil = now + ADMIN_LOCK_MS;
  }
  adminFailures.set(key, state);
}

/** 認証成功で失敗カウントをクリアする */
function clearFailures(key: string): void {
  adminFailures.delete(key);
}

/** 資格情報が設定済みの正しい値と一致するか */
function credentialsMatch(
  env: Env,
  creds: { username?: string; password?: string; token?: string },
): boolean {
  // トークン方式: ADMIN_TOKEN が設定され、提示トークンと一致
  if (isNonEmptyString(env.ADMIN_TOKEN) && isNonEmptyString(creds.token)) {
    if (creds.token === env.ADMIN_TOKEN) return true;
  }
  // ユーザ名+パスワード方式: 両方が設定され、両方一致
  if (
    isNonEmptyString(env.ADMIN_USER) &&
    isNonEmptyString(env.ADMIN_PASSWORD) &&
    isNonEmptyString(creds.username) &&
    isNonEmptyString(creds.password)
  ) {
    if (
      creds.username === env.ADMIN_USER &&
      creds.password === env.ADMIN_PASSWORD
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Authorization ヘッダ / Cookie から資格情報を抽出する。
 * 対応形式:
 *   - Authorization: Bearer <ADMIN_TOKEN>
 *   - Authorization: Basic base64(user:password)
 *   - Cookie: admin_token=<ADMIN_TOKEN>
 */
function extractCredentials(request: Request): {
  username?: string;
  password?: string;
  token?: string;
} {
  const auth = request.headers.get("Authorization") ?? "";

  if (auth.startsWith("Bearer ")) {
    return { token: auth.slice("Bearer ".length).trim() };
  }

  if (auth.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice("Basic ".length).trim());
      const idx = decoded.indexOf(":");
      if (idx >= 0) {
        return {
          username: decoded.slice(0, idx),
          password: decoded.slice(idx + 1),
        };
      }
    } catch {
      // 不正な base64 は未認証扱い
    }
    return {};
  }

  // Cookie フォールバック (admin_token)
  const cookie = request.headers.get("Cookie") ?? "";
  const match = /(?:^|;\s*)admin_token=([^;]+)/.exec(cookie);
  if (match) {
    return { token: decodeURIComponent(match[1]) };
  }

  return {};
}

/**
 * 保護された管理者 API 向けの共有認証チェック。
 * 認証成功時は null を返し、失敗時は返すべき Response を返す。
 * (Requirements 18.3, 19.3, 20.3, 21.1, 21.5 — 未認証では D1 を変更しない)
 */
function requireAdminAuth(request: Request, env: Env): Response | null {
  const creds = extractCredentials(request);
  if (credentialsMatch(env, creds)) {
    return null;
  }
  return authRequired();
}

/**
 * POST /api/admin/login — 管理者認証 (Requirements 21.1〜21.5)
 * 正しい資格情報で token を返し、失敗はカウントして5連続でロックする。
 */
async function handleAdminLogin(
  request: Request,
  env: Env,
): Promise<Response> {
  const now = Date.now();
  const key = requesterKey(request);

  // ロック中は資格情報の照合を行わず拒否する (21.4)
  if (isLocked(key, now)) {
    return lockedResponse();
  }

  const body =
    (await parseJsonBody(request)) as AdminLoginRequest | undefined;

  // ボディの資格情報、または Authorization ヘッダの資格情報を受理する
  const creds =
    body !== undefined && typeof body === "object"
      ? {
          username:
            typeof body.username === "string" ? body.username : undefined,
          password:
            typeof body.password === "string" ? body.password : undefined,
          token: typeof body.token === "string" ? body.token : undefined,
        }
      : extractCredentials(request);

  // ヘッダ経由の資格情報も補完的に許可する
  if (!creds.token && !creds.username) {
    const headerCreds = extractCredentials(request);
    creds.token = creds.token ?? headerCreds.token;
    creds.username = creds.username ?? headerCreds.username;
    creds.password = creds.password ?? headerCreds.password;
  }

  if (credentialsMatch(env, creds)) {
    clearFailures(key);
    // アクセストークンを返す。トークン方式なら同じ値、
    // ユーザ名/パスワード方式では ADMIN_TOKEN があればそれを、
    // なければパスワードを後続要求用トークンとして返す。
    const accessToken = isNonEmptyString(env.ADMIN_TOKEN)
      ? env.ADMIN_TOKEN
      : (env.ADMIN_PASSWORD ?? "");
    return ok({ token: accessToken });
  }

  // 認証失敗を記録 (21.1, 21.4)
  recordFailure(key, now);
  // 記録後に上限へ達した場合はロック応答を返す
  if (isLocked(key, now)) {
    return lockedResponse();
  }
  return authRequired("認証に失敗しました");
}

// ============================================================
// 管理者 API: データ取得 / CSV / 集計 (Requirements 18, 19, 20)
// ============================================================

interface DiagnosisRow {
  session_id: string;
  answers_json: string;
  result_json: string;
}

/** JSON 文字列を安全にパース (失敗時は生文字列を返す) */
function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * GET /api/admin/diagnoses — 全診断データ取得 (Requirements 18.1〜18.3)
 */
async function handleAdminDiagnoses(
  request: Request,
  env: Env,
): Promise<Response> {
  const denied = requireAdminAuth(request, env);
  if (denied) return denied;

  try {
    const { results } = await env.DB.prepare(
      "SELECT session_id, answers_json, result_json FROM diagnosis ORDER BY created_at ASC",
    ).all<DiagnosisRow>();

    const data = (results ?? []).map((row) => ({
      sessionId: row.session_id,
      answers: safeParse(row.answers_json),
      result: safeParse(row.result_json),
    }));

    // 0件時も成功として空配列を返す (18.2)
    return ok(data);
  } catch {
    return serverError("診断データの取得に失敗しました");
  }
}

interface AggregateItem {
  count: number;
  average: number | null;
}

/**
 * GET /api/admin/aggregate — 集計 (Requirements 20.1〜20.3)
 * 事前clarity・事後clarity・事後conviction の有効件数と平均を返す。
 */
async function handleAdminAggregate(
  request: Request,
  env: Env,
): Promise<Response> {
  const denied = requireAdminAuth(request, env);
  if (denied) return denied;

  try {
    // clarity/conviction は 1..5 の整数を有効とみなす
    const preClarity = await env.DB.prepare(
      "SELECT COUNT(clarity) AS cnt, AVG(clarity) AS avg FROM pre_survey WHERE clarity BETWEEN 1 AND 5",
    ).first<{ cnt: number; avg: number | null }>();

    const postClarity = await env.DB.prepare(
      "SELECT COUNT(clarity) AS cnt, AVG(clarity) AS avg FROM post_survey WHERE clarity BETWEEN 1 AND 5",
    ).first<{ cnt: number; avg: number | null }>();

    const postConviction = await env.DB.prepare(
      "SELECT COUNT(conviction) AS cnt, AVG(conviction) AS avg FROM post_survey WHERE conviction BETWEEN 1 AND 5",
    ).first<{ cnt: number; avg: number | null }>();

    const toItem = (
      row: { cnt: number; avg: number | null } | null,
    ): AggregateItem => {
      const count = row?.cnt ?? 0;
      // 0件時は average を null とし、件数0を返す (20.2)
      return { count, average: count > 0 ? (row?.avg ?? null) : null };
    };

    return ok({
      preClarity: toItem(preClarity),
      postClarity: toItem(postClarity),
      postConviction: toItem(postConviction),
    });
  } catch {
    return serverError("集計に失敗しました");
  }
}

// --- CSV 出力 (Requirements 19) ---

const CSV_COLUMNS = [
  "sessionId",
  "consented",
  "consentAt",
  "sessionCreatedAt",
  "preClarity",
  "preFreeText",
  "diagnosisTopFactor",
  "diagnosisResult",
  "postClarity",
  "postConviction",
  "postFreeText",
] as const;

interface CsvRow {
  session_id: string;
  consented: number | null;
  consent_at: string | null;
  session_created_at: string | null;
  pre_clarity: number | null;
  pre_free_text: string | null;
  diag_top_factor: string | null;
  diag_result: string | null;
  post_clarity: number | null;
  post_conviction: number | null;
  post_free_text: string | null;
}

/** CSV の 1 フィールドを RFC 4180 準拠でエスケープする */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 1 レコード分を CSV 行へ整形する */
function csvRow(values: readonly unknown[]): string {
  return values.map(csvEscape).join(",");
}

/**
 * GET /api/admin/export.csv — CSV 出力 (Requirements 19.1〜19.3)
 * sessions を起点に pre_survey/diagnosis/post_survey を LEFT JOIN し、
 * Session ごとに1レコードを出力する。
 */
async function handleAdminExportCsv(
  request: Request,
  env: Env,
): Promise<Response> {
  const denied = requireAdminAuth(request, env);
  if (denied) return denied;

  const header = csvRow(CSV_COLUMNS);

  let rows: CsvRow[] = [];
  try {
    // Session ごとに最新の各テーブル1件を対応付ける。
    // 複数レコードがある場合は最新 (created_at 降順の先頭) を採用する。
    const { results } = await env.DB.prepare(
      `SELECT
         s.id            AS session_id,
         s.consented     AS consented,
         s.consent_at    AS consent_at,
         s.created_at    AS session_created_at,
         pre.clarity     AS pre_clarity,
         pre.free_text   AS pre_free_text,
         diag.top_factor AS diag_top_factor,
         diag.result_json AS diag_result,
         post.clarity    AS post_clarity,
         post.conviction AS post_conviction,
         post.free_text  AS post_free_text
       FROM sessions s
       LEFT JOIN pre_survey pre
         ON pre.id = (SELECT id FROM pre_survey WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1)
       LEFT JOIN diagnosis diag
         ON diag.id = (SELECT id FROM diagnosis WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1)
       LEFT JOIN post_survey post
         ON post.id = (SELECT id FROM post_survey WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1)
       ORDER BY s.created_at ASC`,
    ).all<CsvRow>();
    rows = results ?? [];
  } catch {
    return serverError("CSV出力に失敗しました");
  }

  // Session 0件時はヘッダ行のみ (19.2)
  const lines = [header];
  for (const r of rows) {
    lines.push(
      csvRow([
        r.session_id,
        r.consented,
        r.consent_at,
        r.session_created_at,
        r.pre_clarity,
        r.pre_free_text,
        r.diag_top_factor,
        r.diag_result,
        r.post_clarity,
        r.post_conviction,
        r.post_free_text,
      ]),
    );
  }

  // UTF-8 CSV。末尾に改行を付与する。
  const csv = lines.join("\r\n") + "\r\n";
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="moyamoya-export.csv"',
      ...CORS_HEADERS,
    },
  });
}

// ============================================================
// ルーティング (fetch ハンドラ)
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // CORS プリフライト
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "POST") {
      switch (pathname) {
        case "/api/v1/surveys/pre":
          return handlePreSurvey(request, env);
        case "/api/v1/factor-analyses":
          return handleDiagnosis(request, env);
        case "/api/v1/surveys/post":
          return handlePostSurvey(request, env);
        case "/api/admin/login":
          return handleAdminLogin(request, env);
        default:
          break;
      }
    }

    if (request.method === "GET") {
      switch (pathname) {
        case "/api/admin/diagnoses":
          return handleAdminDiagnoses(request, env);
        case "/api/admin/export.csv":
          return handleAdminExportCsv(request, env);
        case "/api/admin/aggregate":
          return handleAdminAggregate(request, env);
        default:
          break;
      }
    }

    // 未対応のメソッド/パス
    return json(
      {
        ok: false,
        error: { code: "NOT_FOUND", message: "エンドポイントが見つかりません" },
      },
      404,
    );
  },
} satisfies ExportedHandler<Env>;
