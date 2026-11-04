/**
 * 画面遷移制御 (Router)
 *
 * design.md Component 1「Router」の契約を実装する。
 * F-01〜F-15 の画面遷移と、同意状態・進捗・完了状態に応じた遷移ガードを担う。
 *
 * 本ファイルではタスク 10.1 の範囲として以下を実装する:
 *   - navigate / canEnter / current
 *   - 同意ゲート:   同意前は preSurvey 以降への遷移を禁止 (Requirements 3.5)
 *   - 必須チェックゲート: 未回答一覧が非空なら result への遷移を禁止 (Requirements 8.5, 8.6)
 *   - 完了後ゲート: complete から preSurvey/questions/postSurvey への遷移を禁止 (Requirements 13.3)
 *
 * Router はストア実装から疎結合に保つため、ゲート判定に必要な状態
 * (同意済みか / 必須チェックを満たしているか) を外部から注入される
 * コンテキスト (RouterContext) 経由で参照する。これによりストアに直接
 * 依存せず、単体テストが容易になる。
 */

// ============================================================
// 画面名
// ============================================================

/** 画面名 (design.md Component 1)。 */
export type ViewName =
  | "top"
  | "about"
  | "consent"
  | "preSurvey"
  | "questions"
  | "result"
  | "postSurvey"
  | "complete";

/**
 * 同意後にのみ入場できる画面の集合 (F-03 / Requirements 3.5)。
 * 同意前はこれらへの遷移をすべて禁止する。
 */
const CONSENT_GATED_VIEWS: ReadonlySet<ViewName> = new Set<ViewName>([
  "preSurvey",
  "questions",
  "result",
  "postSurvey",
  "complete",
]);

/**
 * 完了画面から戻ることを禁止する画面の集合 (F-15 / Requirements 13.3)。
 * complete 表示中はこれらへの遷移を禁止する。
 */
const COMPLETE_FORBIDDEN_BACK_VIEWS: ReadonlySet<ViewName> = new Set<ViewName>([
  "preSurvey",
  "questions",
  "postSurvey",
]);

// ============================================================
// Router インターフェース / コンテキスト
// ============================================================

/**
 * Router のゲート判定に必要な外部状態を供給するコンテキスト。
 *
 * ストア実装 (DiagnosisStore 等) から Router を疎結合に保つため、
 * ゲッタ関数として注入する。Router は呼び出し時点の最新状態を
 * 都度問い合わせる (遅延評価)。
 */
export interface RouterContext {
  /** Consent が「同意あり」として記録されているか (F-03)。 */
  isConsented(): boolean;
  /**
   * 必須チェックを満たしているか (F-10)。
   * 全20問が "0"〜"4" で回答済み (= 未回答一覧が空) のとき true。
   */
  isRequiredSatisfied(): boolean;
}

/**
 * 画面遷移が発生したときに呼ばれるコールバック。
 * 実描画 (View のマウント等) はアプリ側で配線する。
 */
export type OnNavigate = (view: ViewName, previous: ViewName) => void;

/** Router の契約 (design.md Component 1)。 */
export interface Router {
  /** 現在の画面を遷移・描画する。ガードに反する遷移は行わない。 */
  navigate(view: ViewName): void;
  /** 遷移可否を判定する (同意済み・必須回答済み・完了後ガード)。 */
  canEnter(view: ViewName): boolean;
  /** 現在の画面名を返す。 */
  current(): ViewName;
}

// ============================================================
// 実装
// ============================================================

/** createRouter の生成オプション。 */
export interface CreateRouterOptions {
  /** ゲート判定に用いる外部状態コンテキスト。 */
  context: RouterContext;
  /** 初期画面 (省略時は "top")。 */
  initial?: ViewName;
  /** 遷移成功時に呼ばれるコールバック (任意)。 */
  onNavigate?: OnNavigate;
}

/**
 * Router を生成する。
 *
 * ガードの優先順位 (canEnter):
 *   1. 同意ゲート: 未同意なら CONSENT_GATED_VIEWS への遷移を禁止 (Req 3.5)
 *   2. 必須チェックゲート: 未回答一覧が非空なら result を禁止 (Req 8.5/8.6)
 *   3. 完了後ゲート: current が complete なら
 *      preSurvey/questions/postSurvey への遷移を禁止 (Req 13.3)
 *
 * top/about/consent は上記ゲートの対象外であり、常に入場可能。
 * 同一画面への遷移 (view === current) は常に許可する (再描画相当)。
 */
export function createRouter(options: CreateRouterOptions): Router {
  const { context, onNavigate } = options;

  let currentView: ViewName = options.initial ?? "top";

  const router: Router = {
    /**
     * canEnter: 指定画面へ遷移できるかを判定する。
     *
     * 事後条件:
     *   - 未同意かつ view が同意ゲート対象 → false (Req 3.5)
     *   - view === "result" かつ必須チェック未充足 → false (Req 8.5)
     *   - 現在 complete かつ view が完了後禁止対象 → false (Req 13.3)
     *   - それ以外 → true (必須充足時の result 遷移許可 Req 8.6 を含む)
     */
    canEnter(view: ViewName): boolean {
      // 同一画面への遷移は常に許可 (再描画相当)。
      if (view === currentView) {
        return true;
      }

      // 1. 同意ゲート (Req 3.5): 未同意なら preSurvey 以降を禁止。
      if (!context.isConsented() && CONSENT_GATED_VIEWS.has(view)) {
        return false;
      }

      // 2. 必須チェックゲート (Req 8.5/8.6): 未回答があれば result を禁止。
      if (view === "result" && !context.isRequiredSatisfied()) {
        return false;
      }

      // 3. 完了後ガード (Req 13.3): complete からの後戻りを禁止。
      if (
        currentView === "complete" &&
        COMPLETE_FORBIDDEN_BACK_VIEWS.has(view)
      ) {
        return false;
      }

      return true;
    },

    /**
     * navigate: 画面を遷移する。
     *
     * canEnter が false の場合は遷移を行わず、現在画面を維持する
     * (ガードに反する遷移の抑止)。遷移が成立した場合のみ現在画面を更新し、
     * onNavigate コールバックを呼ぶ。
     */
    navigate(view: ViewName): void {
      if (!router.canEnter(view)) {
        return;
      }
      if (view === currentView) {
        return;
      }
      const previous = currentView;
      currentView = view;
      onNavigate?.(view, previous);
    },

    /** current: 現在の画面名を返す。 */
    current(): ViewName {
      return currentView;
    },
  };

  return router;
}
