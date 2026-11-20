/**
 * SPA エントリポイント: 全コンポーネントの統合と起動フロー (タスク 12.1)
 *
 * design.md「Components and Interfaces」「Example Usage（主要フロー）」に準拠し、
 * Router / DiagnosisStore / SurveyStore / DiagnosisEngine / ApiClient /
 * ErrorHandler / MapRenderer を生成して各 View へ結線する。
 *
 * 起動時:
 *   1. questions.json を fetch し、表示用の質問定義・診断用の重み定義 (QuestionWeight[])・
 *      要因メタ (FactorMeta[]) を得る。
 *   2. sessionId を生成 (crypto.randomUUID())。
 *   3. 全ストア/エンジン/ApiClient/ErrorHandler/MapRenderer を構築する。
 *   4. 同意状態 (consented / sessionId / consentAt) をアプリレベルで保持し、
 *      Router のゲート判定コンテキストへ供給する。
 *   5. Router.onNavigate で各 ViewName に対応する View を #app へ描画する。
 *
 * 画面遷移フロー:
 *   Top → About → Consent → PreSurvey → Questions → Result → PostSurvey → Complete
 *
 * フレームワーク非依存の Vanilla TS で実装する。
 */

import "@/styles/global.css";
import { createRouter, type Router, type ViewName } from "@/router/router";
import { createDiagnosisStore } from "@/store/diagnosisStore";
import type { Group } from "@/store/surveyStore";
import type { FactorMeta } from "@/engine/diagnose";
import { createErrorHandler } from "@/api/errorHandler";
import { createApiClient } from "@/api/apiClient";
import { isFactorOrderValid } from "@/api/resultMapping";
import { loadTypeCatalog, type TypeCatalog } from "@/engine/typeCatalog";
import { initTestModeFromUrl, isTestMode } from "@/config";
import { createMapRenderer } from "@/views/mapRenderer";
import { renderTopView } from "@/views/topView";
import { renderAboutView } from "@/views/aboutView";
import { renderConsentView } from "@/views/consentView";
import { createPreSurveyView } from "@/views/preSurveyView";
import { createQuestionsView, type QuestionDef } from "@/views/questionsView";
import { createResultView } from "@/views/resultView";
import { renderPostSurveyView } from "@/views/postSurveyView";
import { renderCompleteView } from "@/views/completeView";
import type { QuestionId } from "@/models/types";

// ============================================================
// questions.json のスキーマ
// ============================================================

/**
 * questions.json の 1 問分のレコード。
 * 表示用 (text / choices) と診断用 (weights) を併せ持つ。
 */
interface QuestionRecord {
  id: QuestionId;
  text: string;
  choices: [string, string, string, string, string];
  weights: Record<string, number>;
}

/** questions.json 全体のスキーマ。 */
interface QuestionsFile {
  version: number;
  factorMeta: FactorMeta[];
  questions: QuestionRecord[];
}

/**
 * loadQuestions: public/questions.json を読み込み、
 * 表示用 QuestionDef[] と要因メタ FactorMeta[] に分解する。
 * (採点はバックエンドで行う。weights はバックエンドの scoring.py と同じ値を置いている)
 */
async function loadQuestions(): Promise<{
  questions: QuestionDef[];
  factorMeta: FactorMeta[];
}> {
  const res = await fetch("/questions.json", { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`questions.json の読み込みに失敗しました (status: ${res.status})`);
  }
  const file = (await res.json()) as QuestionsFile;

  const questions: QuestionDef[] = file.questions.map((q) => ({
    id: q.id,
    text: q.text,
    choices: q.choices,
  }));

  return { questions, factorMeta: file.factorMeta };
}

// ============================================================
// アプリ状態 (同意・セッション)
// ============================================================

/** アプリレベルで保持する同意・セッション状態 (F-03 / Req 3)。 */
interface AppState {
  /** 利用同意が「同意あり」として記録されているか (Req 3.2)。 */
  consented: boolean;
  /** クライアント生成の sessionId (Req 3.3 / 3.6)。 */
  sessionId: string;
  /** ISO8601 形式の同意日時 (Req 3.3)。未同意なら undefined。 */
  consentAt?: string;
  /** 事前アンケート送信 (API-01) で発行された診断ID・群・テストモードか */
  diagnosis?: DiagnosisInfo;
}

interface DiagnosisInfo {
  diagnosisId: string;
  group: Group;
  isTest: boolean;
}

/** 診断IDなどをタブを閉じるまで保持する (再読み込みしても続きから送れるように) */
const DIAGNOSIS_KEY = "moyamoya.diagnosis.v1";

function saveDiagnosisInfo(info: DiagnosisInfo): void {
  try {
    sessionStorage.setItem(DIAGNOSIS_KEY, JSON.stringify(info));
  } catch {
    // 保存できなくても画面は続ける
  }
}

function loadDiagnosisInfo(): DiagnosisInfo | undefined {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DIAGNOSIS_KEY) ?? "null");
    if (parsed && typeof parsed.diagnosisId === "string" && (parsed.group === "A" || parsed.group === "B")) {
      return { diagnosisId: parsed.diagnosisId, group: parsed.group, isTest: parsed.isTest === true };
    }
  } catch {
    // 壊れていれば無かったことにする
  }
  return undefined;
}

/** テストモードの間、画面の上に帯を出す (本番の切り替え漏れに気づけるように) */
function renderTestModeBanner(): void {
  if (document.getElementById("test-mode-banner")) return;
  const banner = document.createElement("div");
  banner.id = "test-mode-banner";
  banner.className = "test-mode-banner";
  banner.setAttribute("role", "note");
  banner.textContent = "テストモード：この回答はテストデータとして保存され、分析には使われません";
  document.body.prepend(banner);
}

// ============================================================
// 起動
// ============================================================

async function bootstrap(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) {
    throw new Error("#app が見つかりません");
  }

  // URL に ?test=1 があればテストモードにする (そのタブの間有効)
  initTestModeFromUrl();
  if (isTestMode()) renderTestModeBanner();

  // ---- 1. 質問定義の読み込み (診断エンジンへ渡す) ----
  let loaded: Awaited<ReturnType<typeof loadQuestions>>;
  try {
    loaded = await loadQuestions();
  } catch (error) {
    renderFatal(app, "質問の読み込みに失敗しました。ページを再読み込みしてください。");
    console.error(error);
    return;
  }
  const { questions, factorMeta } = loaded;
  if (!isFactorOrderValid(factorMeta)) {
    renderFatal(app, "質問データの形式が正しくありません。管理者に連絡してください。");
    console.error("questions.json の factorMeta が分類ID (1〜10) の順になっていません");
    return;
  }

  // タイプ定義 (175件) を読み込み、すべてのタイプIDがそろっているか確かめる。
  // API の circles / type_categories から作ったIDが必ず見つかるようにするため。
  let typeCatalog: TypeCatalog;
  try {
    typeCatalog = await loadTypeCatalog();
  } catch (error) {
    renderFatal(app, "診断結果の表示に使うデータの読み込みに失敗しました。管理者に連絡してください。");
    console.error(error);
    return;
  }

  // ---- 2. sessionId を生成 (起動時に一意発行) ----
  const appState: AppState = {
    consented: false,
    sessionId: crypto.randomUUID(),
    diagnosis: loadDiagnosisInfo(),
  };
  if (appState.diagnosis?.isTest) renderTestModeBanner();

  // ---- 3. ストア/エンジン/ApiClient/ErrorHandler/MapRenderer を構築 ----
  const diagnosisStore = createDiagnosisStore({ sessionId: appState.sessionId });

  // 中断・再開 (F-24): 保存済み状態が妥当なら復元し、アプリ状態へ反映する。
  // 不在/破損/範囲外の場合は restore() が false を返し、新規開始状態のまま進む。
  if (diagnosisStore.restore()) {
    appState.sessionId = diagnosisStore.getSessionId();
    appState.consented = diagnosisStore.isConsented();
  }
  const errorHandler = createErrorHandler();
  const apiClient = createApiClient({ errorHandler });
  const mapRenderer = createMapRenderer();

  // ---- 4. Router を構築 (同意ゲート・必須チェックのコンテキストをアプリ状態に結線) ----
  // onNavigate は後で代入するため、クロージャ経由で router を参照できるようにする。
  let router: Router;

  const renderView = (view: ViewName): void => {
    switch (view) {
      case "top":
        renderTopView(app, {
          navigate: (v) => router.navigate(v),
        });
        break;

      case "about":
        renderAboutView(app, {
          navigate: (v) => router.navigate(v),
        });
        break;

      case "consent":
        renderConsentView(app, {
          navigate: (v) => router.navigate(v),
          getSessionId: () => appState.sessionId,
          generateSessionId: () => crypto.randomUUID(),
          // Req 3.2 / 3.3: 同意ありを記録し sessionId・同意日時を関連付ける。
          onConsent: (sessionId, consentAt) => {
            appState.sessionId = sessionId;
            appState.consentAt = consentAt;
            appState.consented = true;
            // 中断・再開 (F-24): 保存される PersistedState へ反映する。
            diagnosisStore.setConsented(true);
          },
          // Req 3.4: 非同意時は同意状態を記録しない。
          onDecline: () => {
            appState.consented = false;
            appState.consentAt = undefined;
            diagnosisStore.setConsented(false);
          },
        });
        break;

      case "preSurvey": {
        const preView = createPreSurveyView(app, {
          apiClient,
          // 保存成功 → 診断IDなどを保持して質問画面へ遷移する。
          onSuccess: (res) => {
            appState.diagnosis = { diagnosisId: res.diagnosisId, group: res.group, isTest: res.isTest };
            saveDiagnosisInfo(appState.diagnosis);
            if (res.isTest) renderTestModeBanner();
            router.navigate("questions");
          },
        });
        preView.render();
        break;
      }

      case "questions": {
        const questionsView = createQuestionsView({
          container: app,
          store: diagnosisStore,
          questions,
          // 必須チェックを満たしたときに診断結果画面へ遷移する (Req 8.6)。
          onNavigateToResult: () => router.navigate("result"),
        });
        questionsView.render();
        break;
      }

      case "result": {
        const resultView = createResultView(app, {
          store: diagnosisStore,
          factorMeta,
          typeCatalog,
          apiClient,
          mapRenderer,
          getDiagnosisId: () => appState.diagnosis?.diagnosisId,
          navigateToPostSurvey: () => router.navigate("postSurvey"),
          navigateToTop: () => router.navigate("top"),
        });
        // enter は API-02 で採点→描画を行う非同期処理。
        void resultView.enter();
        break;
      }

      case "postSurvey":
        renderPostSurveyView(app, {
          apiClient,
          getDiagnosisId: () => appState.diagnosis?.diagnosisId,
          getGroup: () => appState.diagnosis?.group ?? "A",
          // Req 12.7 / 13.1: 保存成功後に完了画面へ遷移する。
          navigateToComplete: () => router.navigate("complete"),
        });
        break;

      case "complete":
        renderCompleteView(app, { diagnosisId: appState.diagnosis?.diagnosisId });
        break;
    }
  };

  router = createRouter({
    context: {
      // Req 3.5: 同意前は preSurvey 以降への遷移を禁止する。
      isConsented: () => appState.consented,
      // Req 8.5 / 8.6: 全20問が回答済み (未回答一覧が空) のときのみ result 許可。
      isRequiredSatisfied: () => diagnosisStore.validateRequired().length === 0,
    },
    initial: "top",
    onNavigate: (view) => {
      renderView(view);
    },
  });

  // ---- 5. 初期画面を描画して起動フローを開始する (Top) ----
  renderView(router.current());
}

/** 致命的エラー時のフォールバック表示。 */
function renderFatal(app: HTMLElement, message: string): void {
  app.replaceChildren();
  const section = document.createElement("section");
  section.className = "view view--error";
  section.setAttribute("role", "alert");
  const p = document.createElement("p");
  p.textContent = message;
  section.appendChild(p);
  app.appendChild(section);
}

// ブラウザ起動。
void bootstrap();
