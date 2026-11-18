import { describe, expect, it, vi } from "vitest";
import { createApiClient, toApiAnswers, toViewField, type FetchFn } from "@/api/apiClient";
import { createErrorHandler } from "@/api/errorHandler";
import { CLIENT_VERSION, CONSENT_VERSION } from "@/config";
import type { DiagnosisAnswers } from "@/models/types";

function allAnswers(value: "0" | "1" | "2" | "3" | "4" = "2"): DiagnosisAnswers {
  const a: Record<string, string> = {};
  for (let i = 1; i <= 20; i++) a[`q${i}`] = value;
  return a as DiagnosisAnswers;
}

/** fetch の代わり。送られた URL・ヘッダー・本文を記録し、決めた応答を返す */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { fn: fn as unknown as FetchFn, calls };
}

function client(fetchFn: FetchFn, testMode = false) {
  return createApiClient({
    baseUrl: "https://api.example",
    errorHandler: createErrorHandler({ sink: () => {} }),
    fetchFn,
    isTestMode: () => testMode,
  });
}

describe("toApiAnswers", () => {
  it("q1:'0'〜'4' を q01:1〜5 に変える", () => {
    const a = allAnswers("0");
    (a as Record<string, string>).q20 = "4";
    const out = toApiAnswers(a)!;
    expect(Object.keys(out)).toHaveLength(20);
    expect(out.q01).toBe(1);
    expect(out.q20).toBe(5);
  });

  it("欠けや範囲外があれば null", () => {
    const missing = allAnswers();
    delete (missing as Record<string, string>).q7;
    expect(toApiAnswers(missing)).toBeNull();
    const bad = allAnswers();
    (bad as Record<string, string>).q3 = "5";
    expect(toApiAnswers(bad)).toBeNull();
  });
});

describe("toViewField", () => {
  it("API の項目名を画面の項目名に変える", () => {
    expect(toViewField("pre_explain")).toBe("explain");
    expect(toViewField("pre_causes")).toBe("causes");
    expect(toViewField("age_group")).toBe("ageGroup");
    expect(toViewField("post_fit")).toBe("fit");
    expect(toViewField("post_comment")).toBe("comment");
    expect(toViewField(undefined)).toBeUndefined();
  });
});

describe("postPreSurvey", () => {
  const ok = { diagnosis_id: "d-1", group: "A", status: "pre_done", is_test: false };

  it("API仕様書どおりの本文で送り、診断IDを返す", async () => {
    const { fn, calls } = fakeFetch(201, ok);
    const res = await client(fn).postPreSurvey({ frequency: 2, explain: 2, relation: 1, causes: [3, 9], ageGroup: "30s" });
    expect(res).toEqual({ ok: true, data: { diagnosisId: "d-1", group: "A", isTest: false } });
    expect(calls[0].url).toBe("https://api.example/api/v1/surveys/pre");
    expect(calls[0].body).toEqual({
      consent: true,
      consent_version: CONSENT_VERSION,
      client_version: CLIENT_VERSION,
      pre_frequency: 2,
      pre_explain: 2,
      pre_relation: 1,
      pre_causes: [3, 9],
      age_group: "30s",
    });
    expect(calls[0].headers["X-Test-Mode"]).toBeUndefined();
  });

  it("年代が未回答なら null を送る", async () => {
    const { fn, calls } = fakeFetch(201, ok);
    await client(fn).postPreSurvey({ frequency: 1, explain: 1, relation: 1, causes: [99] });
    expect(calls[0].body.age_group).toBeNull();
  });

  it("テストモードなら X-Test-Mode: 1 を付ける", async () => {
    const { fn, calls } = fakeFetch(201, { ...ok, is_test: true });
    const res = await client(fn, true).postPreSurvey({ frequency: 1, explain: 1, relation: 1, causes: [1] });
    expect(calls[0].headers["X-Test-Mode"]).toBe("1");
    expect(res.ok && res.data.isTest).toBe(true);
  });

  it("400 のエラーを画面の項目名にして返す", async () => {
    const { fn } = fakeFetch(400, { error: { code: "VALIDATION_ERROR", message: "x", field: "pre_explain" } });
    const res = await client(fn).postPreSurvey({ frequency: 1, explain: 9, relation: 1, causes: [1] });
    expect(res).toEqual({ ok: false, error: { code: "VALIDATION_ERROR", message: "x", fields: ["explain"] } });
  });

  it("通信に失敗したら NETWORK", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as FetchFn;
    const res = await client(fn).postPreSurvey({ frequency: 1, explain: 1, relation: 1, causes: [1] });
    expect(!res.ok && res.error.code).toBe("NETWORK");
  });
});

describe("postDiagnosis", () => {
  it("回答を 1〜5 にして送り、採点結果をそのまま返す", async () => {
    const result = { diagnosis_id: "d-1", scores: [], shown: [], main_category_id: null, low_moyamoya: true };
    const { fn, calls } = fakeFetch(200, result);
    const res = await client(fn).postDiagnosis({ diagnosisId: "d-1", answers: allAnswers("3") });
    expect(calls[0].url).toBe("https://api.example/api/v1/factor-analyses");
    expect(calls[0].body.diagnosis_id).toBe("d-1");
    expect(calls[0].body.answers.q01).toBe(4);
    expect(res).toEqual({ ok: true, data: result });
  });

  it("診断IDが無ければ送らない", async () => {
    const { fn, calls } = fakeFetch(200, {});
    const res = await client(fn).postDiagnosis({ diagnosisId: "", answers: allAnswers() });
    expect(!res.ok && res.error.code).toBe("PRECONDITION");
    expect(calls).toHaveLength(0);
  });
});

describe("postPostSurvey", () => {
  it("A群は A1〜A4 と感想を送る", async () => {
    const { fn, calls } = fakeFetch(200, { diagnosis_id: "d-1", status: "completed" });
    const res = await client(fn).postPostSurvey({ diagnosisId: "d-1", explain: 4, relation: 3, fit: 5, discovery: 2, comment: "  よかった " });
    expect(calls[0].body).toEqual({
      diagnosis_id: "d-1",
      post_explain: 4,
      post_relation: 3,
      post_fit: 5,
      post_discovery: 2,
      post_comment: "よかった",
    });
    expect(res).toEqual({ ok: true, data: { diagnosisId: "d-1" } });
  });

  it("B群は A3・A4 を送らず、空の感想は null", async () => {
    const { fn, calls } = fakeFetch(200, { diagnosis_id: "d-1", status: "completed" });
    await client(fn).postPostSurvey({ diagnosisId: "d-1", explain: 4, relation: 3, comment: "   " });
    expect(calls[0].body).toEqual({ diagnosis_id: "d-1", post_explain: 4, post_relation: 3, post_comment: null });
  });
});
