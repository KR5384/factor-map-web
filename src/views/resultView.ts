/**
 * ResultView (診断結果・要因詳細画面): F-11 / F-12 / F-13
 *
 * design.md「Example Usage（主要フロー）」4)〜5) に相当する画面コンポーネント。
 * 全問回答済みの前提で diagnose を実行し、回答を localStorage に保持してから
 * 診断結果を POST する。保存の成否にかかわらず MapRenderer でマップを描画し、
 * 各 Factor の要因詳細 (説明文・関連要因) を提示する。
 *
 * 要件対応:
 *   - 9.1  全問回答済みの Answers から Diagnosis_Result を算出する
 *   - 9.6  sessionId・answers・result を含む診断結果要求を POST する
 *   - 9.7  保存成功時は diagnosisId を得る (応答は呼び出し側 ApiClient が返す)
 *   - 9.8  保存失敗時も回答を localStorage に保持したまま保持する
 *   - 10.1 factors の各要素に対応するバブルマップを MapRenderer で描画する
 *   - 11.1 各 Factor の説明文と、関連要因IDに対応する表示名を表示する
 *   - 11.2 factors を score 降順 (同点 id 昇順) に提示する
 *   - 11.3 topFactorId を強調表示する
 *   - 11.4 関連要因IDが空の Factor は関連要因を表示せず、説明文は表示する
 *
 * 本コンポーネントは vanilla TS で DOM を直接構築する。Router / main 等への
 * 結線は呼び出し側 (navigate コールバック) が担う。
 */

import type {
  DiagnosisAnswers,
  DiagnosisResult,
  Factor,
} from "@/models/types";
import { STORAGE_KEY } from "@/models/types";
import type {
  FactorMeta,
  QuestionWeight,
} from "@/engine/diagnose";
import type { DiagnosisStore } from "@/store/diagnosisStore";
import type { ApiClient } from "@/api/apiClient";
import type { MapRenderer } from "@/views/mapRenderer";
import { persistResult } from "@/views/resultReplay";

// ============================================================
// 依存注入 (テスト容易性 / Router 非依存)
// ============================================================

/** diagnose 相当の純粋関数シグネチャ (依存注入で差し替え可能にする)。 */
export type DiagnoseFn = (
  answers: DiagnosisAnswers,
  weightTable: QuestionWeight[],
  factorMeta: FactorMeta[]
) => DiagnosisResult;

/** ResultView の生成に必要な依存一式。 */
export interface ResultViewDeps {
  /** 回答集合の取得元 (snapshot で全問回答を得る)。 */
  store: DiagnosisStore;
  /** 診断エンジン (純粋関数)。 */
  diagnose: DiagnoseFn;
  /** 質問→要因の重み定義 (questions.json 由来)。 */
  weightTable: QuestionWeight[];
  /** 要因メタ情報 (表示名・説明・関連要因)。結果の要因集合を定める。 */
  factorMeta: FactorMeta[];
  /** 診断結果の保存を担う ApiClient。 */
  apiClient: ApiClient;
  /** 診断マップ描画。 */
  mapRenderer: MapRenderer;
  /** 現在の sessionId を返す getter。 */
  getSessionId: () => string;
  /** 事後アンケート画面への遷移。 */
  navigateToPostSurvey: () => void;
}

/** ResultView の公開契約。 */
export interface ResultView {
  /** 画面へ入る: 診断算出→保存→マップ/要因詳細描画を行う。 */
  enter(): Promise<void>;
}

// ============================================================
// localStorage への回答保持 (9.8 / 10.5 の土台)
// ============================================================

/**
 * persistAnswers: 回答を localStorage の保存済み状態へ反映する。
 *
 * 保存失敗 (POST 失敗) 時でも回答を手元に残すため、POST に先立って書き込む
 * (Req 9.8)。既存の保存済み状態 (sessionId・currentIndex・consented) がある場合は
 * その他フィールドを保ったまま answers を更新する。書込自体が失敗しても描画は継続する。
 */
function persistAnswers(answers: DiagnosisAnswers, sessionId: string): void {
  try {
    let base: Record<string, unknown> = {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed !== null && typeof parsed === "object") {
          base = parsed as Record<string, unknown>;
        }
      } catch {
        // 壊れた保存済み状態は無視して上書きする。
      }
    }
    const next = {
      ...base,
      sessionId: sessionId || (base.sessionId ?? ""),
      answers,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ストレージ書込失敗 (容量超過・無効化等) でも描画は継続する。
  }
}

// ============================================================
// 要因詳細の描画
// ============================================================

/**
 * buildFactorDetails: 要因詳細セクション (<ol>) を構築する純粋な DOM 生成。
 *
 * - factors を score 降順 (同点 id 昇順) に並べて提示する (Req 11.2)。
 *   diagnose は既にこの順で返すが、ResultView 側でも安定ソートして不変条件を保証する。
 * - 各 Factor の説明文を表示する (Req 11.1)。
 * - 関連要因IDに対応する表示名を resolveLabel で解決し一覧表示する (Req 11.1)。
 * - 関連要因IDが空の Factor は関連要因セクションを表示しない (Req 11.4)。
 * - topFactorId に一致する Factor を強調表示する (Req 11.3)。
 */
function buildFactorDetails(result: DiagnosisResult): HTMLElement {
  // id→label の解決表 (関連要因の表示名解決に用いる)。
  const labelById = new Map<string, string>();
  for (const f of result.factors) labelById.set(f.id, f.label);

  // score 降順・同点は id 昇順 (Req 11.2)。元配列を壊さないよう複製してソート。
  const ordered: Factor[] = [...result.factors].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const list = document.createElement("ol");
  list.className = "factor-details";

  for (const factor of ordered) {
    const isTop = factor.id === result.topFactorId;

    const item = document.createElement("li");
    item.className = isTop ? "factor factor--top" : "factor";
    item.dataset.factorId = factor.id;
    item.dataset.score = String(factor.score);

    // 見出し (表示名 + スコア)。最大要因は強調 (Req 11.3)。
    const heading = document.createElement("h3");
    heading.className = "factor__label";
    heading.textContent = factor.label;
    if (isTop) {
      heading.dataset.top = "true";
      heading.setAttribute("aria-label", `${factor.label}（最大要因）`);
      const badge = document.createElement("span");
      badge.className = "factor__top-badge";
      badge.textContent = "最大要因";
      heading.appendChild(badge);
    }
    item.appendChild(heading);

    const score = document.createElement("p");
    score.className = "factor__score";
    score.textContent = `スコア: ${factor.score}`;
    item.appendChild(score);

    // 説明文は常に表示する (Req 11.1 / 11.4)。
    const description = document.createElement("p");
    description.className = "factor__description";
    description.textContent = factor.description;
    item.appendChild(description);

    // 関連要因: 空のときはセクションごと表示しない (Req 11.4)。
    if (factor.relatedFactorIds.length > 0) {
      const relatedSection = document.createElement("div");
      relatedSection.className = "factor__related";

      const relatedTitle = document.createElement("p");
      relatedTitle.className = "factor__related-title";
      relatedTitle.textContent = "関連要因";
      relatedSection.appendChild(relatedTitle);

      const relatedList = document.createElement("ul");
      relatedList.className = "factor__related-list";
      for (const relatedId of factor.relatedFactorIds) {
        const relatedItem = document.createElement("li");
        relatedItem.className = "factor__related-item";
        relatedItem.dataset.relatedId = relatedId;
        // 表示名を解決。結果集合に無い id はフォールバックとして id を表示する。
        relatedItem.textContent = labelById.get(relatedId) ?? relatedId;
        relatedList.appendChild(relatedItem);
      }
      relatedSection.appendChild(relatedList);
      item.appendChild(relatedSection);
    }

    list.appendChild(item);
  }

  return list;
}

// ============================================================
// ResultView ファクトリ
// ============================================================

/**
 * createResultView: 診断結果・要因詳細画面を生成する。
 *
 * @param container 描画先コンテナ。enter() のたびに内容を再構築する。
 * @param deps      依存一式 (store / diagnose / apiClient / mapRenderer など)。
 */
export function createResultView(
  container: HTMLElement,
  deps: ResultViewDeps
): ResultView {
  return {
    async enter(): Promise<void> {
      const {
        store,
        diagnose,
        weightTable,
        factorMeta,
        apiClient,
        mapRenderer,
        getSessionId,
        navigateToPostSurvey,
      } = deps;

      // 全問回答済みの Answers から Diagnosis_Result を算出する (Req 9.1)。
      const answers = store.snapshot();
      const result = diagnose(answers, weightTable, factorMeta);

      const sessionId = getSessionId();

      // 保存に先立ち回答を localStorage へ保持する。
      // これにより POST 失敗時も回答が手元に残り続ける (Req 9.8)。
      persistAnswers(answers, sessionId);

      // 診断結果本体も再表示用キーへ保持する (F-25 / Req 17.2)。
      // 完了画面からの結果再表示が、確定済みの factors 並び順・topFactorId を
      // そのまま再利用できるようにする。書込失敗時も描画は継続する。
      persistResult(result);

      // 画面骨格を構築する (保存の成否にかかわらずマップと要因詳細を描画する)。
      container.replaceChildren();

      const root = document.createElement("section");
      root.className = "result-view";
      root.setAttribute("aria-label", "診断結果");

      const title = document.createElement("h2");
      title.className = "result-view__title";
      title.textContent = "診断結果";
      root.appendChild(title);

      // マップ描画先。
      const mapContainer = document.createElement("div");
      mapContainer.className = "result-view__map";
      root.appendChild(mapContainer);

      // 要因詳細。
      const detailsContainer = document.createElement("div");
      detailsContainer.className = "result-view__details";
      detailsContainer.appendChild(buildFactorDetails(result));
      root.appendChild(detailsContainer);

      // 事後アンケートへの導線。
      const nextButton = document.createElement("button");
      nextButton.type = "button";
      nextButton.className = "result-view__next";
      nextButton.textContent = "事後アンケートへ進む";
      nextButton.addEventListener("click", () => navigateToPostSurvey());
      root.appendChild(nextButton);

      container.appendChild(root);

      // 診断マップを描画する (Req 10.1)。POST の前に行い、保存に失敗しても
      // マップ表示を継続できるようにする (Req 10.5)。
      mapRenderer.render(mapContainer, result);

      // 診断結果を保存する (Req 9.6)。
      // 失敗は ApiClient / ErrorHandler 側で通知・リトライ提示される。ここでは
      // 成否にかかわらず描画済みのマップ・要因詳細を維持する (Req 9.8 / 10.5)。
      try {
        await apiClient.postDiagnosis({ sessionId, answers, result });
      } catch {
        // ネットワーク例外等でも回答は既に localStorage に保持済みで、
        // マップ・要因詳細も描画済みのため、表示を継続する。
      }
    },
  };
}
