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
import { createSurveyStore } from "@/store/surveyStore";
import { diagnose, type FactorMeta, type QuestionWeight } from "@/engine/diagnose";
import { createErrorHandler } from "@/api/errorHandler";
import { createApiClient } from "@/api/apiClient";
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
 * 表示用 QuestionDef[] と診断用 QuestionWeight[] / FactorMeta[] に分解する。
 */
async function loadQuestions(): Promise<{
  questions: QuestionDef[];
  weightTable: QuestionWeight[];
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

  const weightTable: QuestionWeight[] = file.questions.map((q) => ({
    questionId: q.id,
    weights: q.weights,
  }));

  return { questions, weightTable, factorMeta: file.factorMeta };
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
}

// ============================================================
// 起動
// ============================================================

async function bootstrap(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) {
    throw new Error("#app が見つかりません");
  }

  // ---- 1. 質問定義の読み込み (診断エンジンへ渡す) ----
  let loaded: Awaited<ReturnType<typeof loadQuestions>>;
  try {
    loaded = await loadQuestions();
  } catch (error) {
    renderFatal(app, "質問の読み込みに失敗しました。ページを再読み込みしてください。");
    console.error(error);
    return;
  }
  const { questions, weightTable, factorMeta } = loaded;

  // ---- 2. sessionId を生成 (起動時に一意発行) ----
  const appState: AppState = {
    consented: false,
    sessionId: crypto.randomUUID(),
  };

  // ---- 3. ストア/エンジン/ApiClient/ErrorHandler/MapRenderer を構築 ----
  const diagnosisStore = createDiagnosisStore({ sessionId: appState.sessionId });

  // 中断・再開 (F-24): 保存済み状態が妥当なら復元し、アプリ状態へ反映する。
  // 不在/破損/範囲外の場合は restore() が false を返し、新規開始状態のまま進む。
  if (diagnosisStore.restore()) {
    appState.sessionId = diagnosisStore.getSessionId();
    appState.consented = diagnosisStore.isConsented();
  }
  const preSurveyStore = createSurveyStore("pre");
  const postSurveyStore = createSurveyStore("post");

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
          store: preSurveyStore,
          apiClient,
          getSessionId: () => appState.sessionId,
          // Req 4.7: 保存成功後に質問画面へ遷移する。
          onSuccess: () => router.navigate("questions"),
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
          diagnose,
          weightTable,
          factorMeta,
          apiClient,
          mapRenderer,
          getSessionId: () => appState.sessionId,
          navigateToPostSurvey: () => router.navigate("postSurvey"),
        });
        // enter は診断算出→保存→描画を行う非同期処理 (失敗しても描画は継続)。
        void resultView.enter();
        break;
      }

      case "postSurvey":
        renderPostSurveyView(app, {
          store: postSurveyStore,
          apiClient,
          getSessionId: () => appState.sessionId,
          // Req 12.7 / 13.1: 保存成功後に完了画面へ遷移する。
          navigateToComplete: () => router.navigate("complete"),
        });
        break;

      case "complete":
        renderCompleteView(app, {});
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
