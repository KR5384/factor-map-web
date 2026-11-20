/**
 * ResultView (診断結果・要因詳細画面): F-11 / F-12 / F-13
 *
 * 20問の回答を API-02 (factor-analyses) に送り、バックエンドが採点した結果を表示する。
 * 採点はバックエンドだけで行う (画面に出す結果と DB に保存する結果を一致させるため)。
 * 通信に失敗したときは結果を出さず、再試行ボタンを出す。
 *
 * 要件対応:
 *   - 9.8  回答は送信前に localStorage に保持する
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
import type { FactorMeta } from "@/engine/diagnose";
import type { DiagnosisStore } from "@/store/diagnosisStore";
import type { ApiClient } from "@/api/apiClient";
import { toDiagnosisResult } from "@/api/resultMapping";
import type { MapRenderer } from "@/views/mapRenderer";
import { persistResult } from "@/views/resultReplay";
import type { FactorAnalysisResponse } from "@/api/apiClient";
import { linksAmong, type MapLink } from "@/engine/factorLinks";
import { classifyType, type TypeResult } from "@/engine/typeCatalog";

// ============================================================
// 依存注入 (テスト容易性 / Router 非依存)
// ============================================================

/** ResultView の生成に必要な依存一式。 */
export interface ResultViewDeps {
  /** 回答集合の取得元 (snapshot で全問回答を得る)。 */
  store: DiagnosisStore;
  /** 要因メタ情報 (表示名・説明・関連要因)。分類ID 1〜10 の順に並んでいること。 */
  factorMeta: FactorMeta[];
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
function buildFactorDetails(
  result: DiagnosisResult,
  allFactors: readonly Factor[]
): HTMLElement {
  // id→label の解決表 (関連要因の表示名解決に用いる)。
  // 表示対象は絞り込み済みだが、関連要因は全要因から名前を引く。
  const labelById = new Map<string, string>();
  for (const f of allFactors) labelById.set(f.id, f.label);

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
// 見出し・つながりの説明
// ============================================================

/**
 * タイプ名の見出しを構築する。
 *
 * 表示する要因が1つなら単独タイプ、2つなら45タイプ、3つ以上なら120タイプの名前になる。
 * 主役はマップなので、見出しは小さめにとどめる。判定に使った要因名も添える。
 */
function buildTypeHeadline(
  type: TypeResult,
  allFactors: readonly Factor[]
): HTMLElement {
  const box = document.createElement("div");
  box.className = "result-view__headline";
  box.dataset.typeKind = type.kind;

  const lead = document.createElement("p");
  lead.className = "result-view__headline-lead";
  lead.textContent =
    type.kind === "single" ? "いちばん大きいのは…" : "あなたのもやもやは…";
  box.appendChild(lead);

  const name = document.createElement("p");
  name.className = "result-view__headline-name";
  name.textContent = type.displayName;
  box.appendChild(name);

  if (type.description) {
    const desc = document.createElement("p");
    desc.className = "result-view__headline-desc";
    desc.textContent = type.description;
    box.appendChild(desc);
  }

  // 判定に使った要因 (例: 時間・余白不足 × 回復不足 × 情報過多/認知負荷)。
  const labelById = new Map(allFactors.map((f) => [f.id, f.label]));
  const parts = type.factorIds.map((id) => labelById.get(id) ?? id);
  const basis = document.createElement("p");
  basis.className = "result-view__headline-basis";
  basis.textContent = parts.join(" × ");
  box.appendChild(basis);

  return box;
}

/**
 * バックエンドが選んだ表示対象 (shown) だけを、順位順に残した結果を返す。
 *
 * 表示ルール (1位は必ず、2位以降は80%以上かつ50点以上、最大4つ) は
 * バックエンドで判定済みなので、画面側では判定し直さない。
 * shown が空のときは、全要因の先頭 (1位) だけを出す。
 */
function selectShown(
  result: DiagnosisResult,
  shown: FactorAnalysisResponse["shown"],
  factorMeta: readonly FactorMeta[]
): DiagnosisResult {
  const byId = new Map(result.factors.map((f) => [f.id, f]));
  const factors = [...shown]
    .sort((a, b) => a.rank - b.rank)
    .map((s) => factorMeta[s.category_id - 1]?.id)
    .map((id) => (id ? byId.get(id) : undefined))
    .filter((f): f is Factor => f !== undefined);
  return {
    ...result,
    factors: factors.length > 0 ? factors : result.factors.slice(0, 1),
  };
}

/**
 * 矢印の意味を伝える説明 (凡例 + つながりごとの文) を構築する。
 * 実線は調査で確認できたつながり、点線は可能性があるつながり。
 */
function buildLinkNotes(links: readonly MapLink[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "result-view__links";

  const list = document.createElement("ul");
  list.className = "result-view__links-list";
  for (const link of links) {
    const item = document.createElement("li");
    item.className = `result-view__link result-view__link--${link.status}`;
    item.dataset.from = link.from;
    item.dataset.to = link.to;
    item.textContent = `${link.status === "confirmed" ? "→" : "⇢"} ${link.message}`;
    list.appendChild(item);
  }
  box.appendChild(list);

  const legend = document.createElement("p");
  legend.className = "result-view__links-legend";
  legend.textContent = "実線は調査で確かめられたつながり、点線はそうなる可能性があるつながりです。";
  box.appendChild(legend);

  return box;
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

export function createResultView(
  container: HTMLElement,
  deps: ResultViewDeps
): ResultView {
  const view: ResultView = {
    async enter(): Promise<void> {
      const {
        store,
        factorMeta,
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

      // 画面に出す要因は、バックエンドが返した shown (順位順、最大4つ) に従う。
      // 目立ったもやもやが無い場合 (low_moyamoya) は、全要因をそのまま出す。
      const lowMoyamoya = res.data.low_moyamoya;
      const displayResult: DiagnosisResult = lowMoyamoya
        ? result
        : selectShown(result, res.data.shown, factorMeta);
      // 画面に出ている要因どうしを結ぶ、調査の根拠があるつながりだけを描く。
      const links = lowMoyamoya
        ? []
        : linksAmong(displayResult.factors.map((f) => f.id));

      // 再表示用キーへ保持する (F-25 / Req 17.2)。画面に出した内容と同じものを残す。
      persistResult(displayResult);

      container.replaceChildren();

      const root = document.createElement("section");
      root.className = "result-view";
      root.setAttribute("aria-label", "診断結果");

      const title = document.createElement("h2");
      title.className = "result-view__title";
      title.textContent = "診断結果";
      root.appendChild(title);

      if (lowMoyamoya) {
        const note = document.createElement("p");
        note.className = "view__lead result-view__low";
        note.textContent =
          "いまは、目立って大きいもやもやは見つかりませんでした。下の図は、それぞれの要因の大きさの目安です。";
        root.appendChild(note);
      } else {
        // 見出し: 表示する要因の組み合わせから判定したタイプ名 (主役はマップ)。
        const type = classifyType(displayResult.factors);
        if (type) {
          root.appendChild(buildTypeHeadline(type, result.factors));
        }
      }

      // マップ描画先。
      const mapContainer = document.createElement("div");
      mapContainer.className = "result-view__map";
      root.appendChild(mapContainer);

      // つながりの説明 (矢印の意味)。
      if (links.length > 0) {
        root.appendChild(buildLinkNotes(links));
      }

      // 要因詳細。
      const detailsContainer = document.createElement("div");
      detailsContainer.className = "result-view__details";
      detailsContainer.appendChild(
        buildFactorDetails(displayResult, result.factors)
      );
      root.appendChild(detailsContainer);

      // 事後アンケートへの導線。
      const nextButton = document.createElement("button");
      nextButton.type = "button";
      nextButton.className = "result-view__next";
      nextButton.textContent = "事後アンケートへ進む";
      nextButton.addEventListener("click", () => navigateToPostSurvey());
      root.appendChild(nextButton);

      container.appendChild(root);

      // 診断マップを描画する (Req 10.1)。
      mapRenderer.render(mapContainer, displayResult, { links });
    },
  };
  return view;
}
