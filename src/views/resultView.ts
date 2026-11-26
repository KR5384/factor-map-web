/**
 * ResultView (診断結果・要因詳細画面): F-11 / F-12 / F-13
 *
 * 20問の回答を API-02 (factor-analyses) に送り、バックエンドが採点・判定した結果を表示する。
 * 採点も「どれを出すか」もバックエンドだけで決める (画面に出す結果と DB に保存する結果を一致させるため)。
 * 通信に失敗したときは結果を出さず、再試行ボタンを出す。
 *
 * 表示 (2026-11-20 決定):
 *   - 円        : circles (点数の高い順に最大5つ)。タイプの円は色を変える
 *   - 線        : links (タイプの要因どうし。2つなら1本、3つなら3本、1つなら無し)
 *   - タイプ    : result_type_id で types.json を引き、タイプ名＋ひとこと解説を出す
 *   - もやもやが少ない人 (low_moyamoya): タイプ (1つ) に「もやもやは少なめです」を添える
 *   - 全部0点 (result_type_id が null): タイプも円も無し。その旨の文だけ出す
 *
 * 要件対応:
 *   - 9.8  回答は送信前に localStorage に保持する
 *   - 10.1 円に出す要因ごとにバブルを MapRenderer で描画する
 *   - 11.1 各 Factor の説明文と、関連要因IDに対応する表示名を表示する
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
import type { FactorMeta } from "@/engine/diagnose";
import type { DiagnosisStore } from "@/store/diagnosisStore";
import type { ApiClient } from "@/api/apiClient";
import {
  categoryIdOfFactor,
  toDiagnosisResult,
  toResultDisplay,
} from "@/api/resultMapping";
import type { MapRenderer } from "@/views/mapRenderer";
import { persistResult } from "@/views/resultReplay";
import {
  typeIdOf,
  type TypeCatalog,
  type TypeEntry,
} from "@/engine/typeCatalog";

// ============================================================
// 文言 (正式な文言が決まったらここを直す)
// ============================================================

/** もやもやが少ない人 (1位でも50点未満) に添える一言。【仮】 */
export const LOW_MOYAMOYA_MESSAGE = "もやもやは少なめです。";

/** 全部0点 (タイプも円も無い) ときの文。【仮】 */
export const NO_MOYAMOYA_MESSAGE =
  "いまは、もやもやの要因はほとんど見当たりませんでした。";

// ============================================================
// 依存注入 (テスト容易性 / Router 非依存)
// ============================================================

/** ResultView の生成に必要な依存一式。 */
export interface ResultViewDeps {
  /** 回答集合の取得元 (snapshot で全問回答を得る)。 */
  store: DiagnosisStore;
  /** 要因メタ情報 (表示名・説明・関連要因)。分類ID 1〜10 の順に並んでいること。 */
  factorMeta: FactorMeta[];
  /** タイプ定義 (types.json。起動時に 175件そろっていることを確認済み)。 */
  typeCatalog: TypeCatalog;
  /** API-02 を呼ぶ ApiClient。 */
  apiClient: ApiClient;
  /** 診断マップ描画。 */
  mapRenderer: MapRenderer;
  /** API-01 で発行された診断ID。 */
  getDiagnosisId: () => string | undefined;
  /** 事後アンケート画面への遷移。 */
  navigateToPostSurvey: () => void;
  /** 最初からやり直す (トップ画面へ)。 */
  navigateToTop: () => void;
}

/** ResultView の公開契約。 */
export interface ResultView {
  /** 画面へ入る: 採点 (API-02) → マップ/タイプ/要因詳細の描画を行う。 */
  enter(): Promise<void>;
}

// ============================================================
// localStorage への回答保持 (9.8 の土台)
// ============================================================

/**
 * persistAnswers: 回答を localStorage の保存済み状態へ反映する。
 *
 * 送信失敗時でも回答を手元に残すため、送信に先立って書き込む (Req 9.8)。
 * 既存の保存済み状態 (sessionId・currentIndex・consented) がある場合は
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
 * - 円に出した要因を、API の順位順のまま並べる。
 * - 各 Factor の説明文を表示する (Req 11.1)。単独タイプ名があれば見出しに添える。
 * - 関連要因IDに対応する表示名を一覧表示する (Req 11.1)。関連要因は全要因から名前を引く。
 * - 関連要因IDが空の Factor は関連要因セクションを表示しない (Req 11.4)。
 * - topFactorId に一致する Factor を強調表示する (Req 11.3)。
 * - タイプの要因には印を付ける (data-type="true")。
 */
function buildFactorDetails(
  factors: readonly Factor[],
  topFactorId: string,
  typeFactorIds: ReadonlySet<string>,
  allFactors: readonly Factor[]
): HTMLElement {
  const labelById = new Map<string, string>();
  for (const f of allFactors) labelById.set(f.id, f.label);

  const list = document.createElement("ol");
  list.className = "factor-details";

  for (const factor of factors) {
    const isTop = factor.id === topFactorId;

    const item = document.createElement("li");
    item.className = isTop ? "factor factor--top" : "factor";
    item.dataset.factorId = factor.id;
    item.dataset.score = String(factor.score);
    if (typeFactorIds.has(factor.id)) item.dataset.type = "true";

    // 見出し (表示名 + 単独タイプ名)。最大要因は強調 (Req 11.3)。
    const heading = document.createElement("h3");
    heading.className = "factor__label";
    heading.textContent = factor.typeName
      ? `${factor.label}（『${factor.typeName}』）`
      : factor.label;
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
// タイプの見出し
// ============================================================

/**
 * タイプ名の見出しを構築する。
 *
 * タイプの要因 (最大3つ) の組み合わせで決まるタイプ名とひとこと解説を出す。
 * 「Nつの組み合わせ」→ タイプ名 (大きく) → ひとこと解説 の順に並べ、すぐ下のマップにつなげる。
 */
function buildTypeHeadline(
  typeId: string,
  entry: TypeEntry,
  typeFactors: readonly Factor[]
): HTMLElement {
  const box = document.createElement("div");
  box.className = "result-view__headline";
  box.dataset.typeId = typeId;
  box.dataset.typeSize = String(typeFactors.length);

  // 小見出し: 何個の要因の組み合わせか (例: 「3つの組み合わせ」)。
  const lead = document.createElement("p");
  lead.className = "result-view__headline-lead";
  lead.textContent =
    typeFactors.length <= 1 ? "いちばん大きいもやもや" : `${typeFactors.length}つの組み合わせ`;
  box.appendChild(lead);

  // タイプ名 (括弧なし)。判定に使った要因はマップの線で示すので、ここには並べない。
  const name = document.createElement("p");
  name.className = "result-view__headline-name";
  name.textContent = entry.name;
  box.appendChild(name);

  if (entry.description) {
    const desc = document.createElement("p");
    desc.className = "result-view__headline-desc";
    desc.textContent = entry.description;
    box.appendChild(desc);
  }

  return box;
}

// ============================================================
// ResultView ファクトリ
// ============================================================

/** 結果が出せないときの表示 (再試行 or やり直し)。 */
function renderMessage(
  container: HTMLElement,
  message: string,
  action: { label: string; onClick: () => void }
): void {
  container.replaceChildren();
  const root = document.createElement("section");
  root.className = "result-view result-view--message";
  root.setAttribute("role", "alert");
  const p = document.createElement("p");
  p.className = "view__lead";
  p.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button--primary";
  button.textContent = action.label;
  button.addEventListener("click", action.onClick);
  root.append(p, button);
  container.appendChild(root);
}

/**
 * createResultView: 診断結果・要因詳細画面を生成する。
 *
 * @param container 描画先コンテナ。enter() のたびに内容を再構築する。
 * @param deps      依存一式 (store / typeCatalog / apiClient / mapRenderer など)。
 */
export function createResultView(
  container: HTMLElement,
  deps: ResultViewDeps
): ResultView {
  const view: ResultView = {
    async enter(): Promise<void> {
      const {
        store,
        factorMeta,
        typeCatalog,
        apiClient,
        mapRenderer,
        getDiagnosisId,
        navigateToPostSurvey,
        navigateToTop,
      } = deps;

      const answers = store.snapshot();
      const diagnosisId = getDiagnosisId();

      // 送信に先立ち回答を localStorage へ保持する (Req 9.8)。
      persistAnswers(answers, store.getSessionId());

      if (!diagnosisId) {
        renderMessage(
          container,
          "診断の情報が見つかりませんでした。お手数ですが最初からやり直してください。",
          { label: "最初からやり直す", onClick: navigateToTop }
        );
        return;
      }

      container.replaceChildren();
      const loading = document.createElement("p");
      loading.className = "view__lead";
      loading.setAttribute("role", "status");
      loading.textContent = "診断しています…";
      container.appendChild(loading);

      // バックエンドで採点する (API-02)。同じ回答の再送信には保存済みの結果が返る。
      const res = await apiClient.postDiagnosis({ diagnosisId, answers });
      if (!res.ok) {
        renderMessage(
          container,
          res.error.code === "NOT_FOUND"
            ? "診断の情報が見つかりませんでした。お手数ですが最初からやり直してください。"
            : "診断結果を受け取れませんでした。通信状況を確認して、もう一度お試しください。",
          res.error.code === "NOT_FOUND"
            ? { label: "最初からやり直す", onClick: navigateToTop }
            : { label: "もう一度試す", onClick: () => void view.enter() }
        );
        return;
      }

      const result = toDiagnosisResult(res.data, factorMeta);
      const display = toResultDisplay(res.data, result, factorMeta);

      // 要因詳細の見出しに添える単独タイプ名 (types.json の 1つのタイプ)。
      const withTypeName = (f: Factor): Factor => {
        const c = categoryIdOfFactor(f.id);
        const name = c !== undefined ? typeCatalog.get(typeIdOf([c]))?.name : undefined;
        return name ? { ...f, typeName: name } : f;
      };
      const circles = display.circles.map(withTypeName);
      const typeFactorIds = display.typeFactors.map((f) => f.id);

      container.replaceChildren();

      const root = document.createElement("section");
      root.className = "result-view";
      root.setAttribute("aria-label", "診断結果");

      const title = document.createElement("h2");
      title.className = "result-view__title";
      title.textContent = "診断結果";
      root.appendChild(title);

      // 全部0点: タイプも円も無い。
      if (display.typeId === null) {
        const note = document.createElement("p");
        note.className = "view__lead result-view__none";
        note.textContent = NO_MOYAMOYA_MESSAGE;
        root.appendChild(note);
      } else {
        // もやもやが少ない人: タイプ (1つ) に一言を添える。
        if (display.lowMoyamoya) {
          const note = document.createElement("p");
          note.className = "view__lead result-view__low";
          note.textContent = LOW_MOYAMOYA_MESSAGE;
          root.appendChild(note);
        }

        // 見出し: タイプ名＋ひとこと解説 (主役はマップ)。
        // types.json は起動時に175件そろっていることを確かめているので、通常は必ず見つかる。
        const entry = typeCatalog.get(display.typeId);
        if (entry) {
          root.appendChild(buildTypeHeadline(display.typeId, entry, display.typeFactors));
        } else {
          console.error(`types.json にタイプID ${display.typeId} がありません`);
        }
      }

      // マップ描画先 (円が無いときは出さない)。
      const mapContainer = document.createElement("div");
      mapContainer.className = "result-view__map";
      if (circles.length > 0) root.appendChild(mapContainer);

      // 要因詳細 (円に出した要因)。
      if (circles.length > 0) {
        const detailsContainer = document.createElement("div");
        detailsContainer.className = "result-view__details";
        detailsContainer.appendChild(
          buildFactorDetails(circles, result.topFactorId, new Set(typeFactorIds), result.factors)
        );
        root.appendChild(detailsContainer);
      }

      // 事後アンケートへの導線。
      const nextButton = document.createElement("button");
      nextButton.type = "button";
      nextButton.className = "result-view__next";
      nextButton.textContent = "事後アンケートへ進む";
      nextButton.addEventListener("click", () => navigateToPostSurvey());
      root.appendChild(nextButton);

      container.appendChild(root);

      if (circles.length > 0) {
        const displayResult: DiagnosisResult = {
          ...result,
          factors: circles,
          typeFactorIds,
        };
        // 再表示用キーへ保持する (F-25 / Req 17.2)。画面に出した内容と同じものを残す。
        persistResult(displayResult);

        // 診断マップを描画する (Req 10.1)。タイプの円は色を変え、タイプの要因どうしを線で結ぶ。
        mapRenderer.render(mapContainer, displayResult, {
          links: display.lines,
          highlightIds: typeFactorIds,
        });
      }
    },
  };
  return view;
}
