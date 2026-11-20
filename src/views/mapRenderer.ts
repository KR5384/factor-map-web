/**
 * MapRenderer (診断マップ描画): 脳内メーカー風のバブルマップを描画する。
 *
 * design.md「Component 5: MapRenderer」に準拠。
 *   interface MapRenderer { render(container: HTMLElement, result: DiagnosisResult): void; }
 *
 * 要件対応 (F-12 / Requirement 10):
 *   - 10.1 factors の各要素に1つのバブルを対応付け、バブル総数を factors 要素数と一致させる
 *   - 10.2 バブルサイズを score (0..100) に対して単調非減少に決定する
 *   - 10.3 各バブルに label を表示し、いずれのバブルも重ならないよう配置する
 *   - 10.4 確定から2秒以内に描画を完了する (同期的な SVG 生成のため即時完了)
 *   - 10.5 の「保存失敗時の localStorage 再算出描画」は ResultView (タスク11.4) の責務。
 *          本モジュールは与えられた DiagnosisResult からのみ純粋に描画する。
 *          (同一 DiagnosisResult → 同一マップ、であることで 10.5 の同一性を支える)
 */

import type { DiagnosisResult, Factor } from "@/models/types";
import { SCORE_MAX, SCORE_MIN } from "@/models/types";

/** 円どうしを結ぶ線 1 本 (向きは無い)。タイプの要因どうしを結ぶのに使う。 */
export interface MapLine {
  from: string;
  to: string;
}

// ============================================================
// レイアウト定数
// ============================================================

const SVG_NS = "http://www.w3.org/2000/svg";

/** バブル半径の下限・上限 (px)。score=0 で MIN、score=100 で MAX。 */
export const BUBBLE_RADIUS_MIN = 24;
export const BUBBLE_RADIUS_MAX = 64;

/** バブル間の最小間隔 (px)。これ以上の余白を取り重なりを防ぐ。 */
const BUBBLE_GAP = 12;

/** セルのパディング (px)。グリッドセルの内側余白。 */
const CELL_PADDING = BUBBLE_GAP;

// ============================================================
// 純粋関数: score → 半径
// ============================================================

/**
 * radiusForScore: score (0..100) をバブル半径 (px) へ線形写像する純粋関数。
 *
 * 性質:
 *   - score に対して単調非減少 (Req 10.2)。a.score >= b.score ⇒ radius(a) >= radius(b)
 *   - 常に [BUBBLE_RADIUS_MIN, BUBBLE_RADIUS_MAX] の範囲に収まる
 *   - 範囲外の score は 0..100 にクランプしてから写像する (安全側)
 *
 * 単調性はテスト (タスク9.2) で検証できるよう、副作用のない純粋関数として公開する。
 */
export function radiusForScore(score: number): number {
  const clamped = Math.max(SCORE_MIN, Math.min(SCORE_MAX, score));
  const ratio = clamped / (SCORE_MAX - SCORE_MIN); // 0..1
  return BUBBLE_RADIUS_MIN + ratio * (BUBBLE_RADIUS_MAX - BUBBLE_RADIUS_MIN);
}

// ============================================================
// 純粋関数: グリッドレイアウト算出
// ============================================================

/** 1つのバブルの配置情報。 */
export interface BubbleLayout {
  factor: Factor;
  /** 中心座標 (px) */
  cx: number;
  cy: number;
  /** 半径 (px) */
  radius: number;
}

/** マップ全体のレイアウト結果。 */
export interface MapLayout {
  width: number;
  height: number;
  bubbles: BubbleLayout[];
}

/**
 * computeLayout: factors から重なりのないグリッド配置を算出する純粋関数。
 *
 * 各バブルを等サイズのセル (最大バブルが収まる大きさ) の中心に置くことで、
 * セルが重ならない限りバブルも重ならないことを決定的に保証する (Req 10.3)。
 * バブル総数は factors 要素数と常に一致する (Req 10.1)。
 *
 * @param factors 描画対象の要因 (DiagnosisResult.factors の並び順を維持)
 */
export function computeLayout(factors: Factor[]): MapLayout {
  const count = factors.length;
  if (count === 0) {
    return { width: 0, height: 0, bubbles: [] };
  }

  // セル1辺 = 最大バブル直径 + 余白。全セル同一サイズで重なりを防ぐ。
  const cellSize = BUBBLE_RADIUS_MAX * 2 + CELL_PADDING * 2;

  // 可能な限り正方形に近いグリッド (列数 = ceil(sqrt(n)))。
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  const width = cols * cellSize;
  const height = rows * cellSize;

  const bubbles: BubbleLayout[] = factors.map((factor, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cx = col * cellSize + cellSize / 2;
    const cy = row * cellSize + cellSize / 2;
    return {
      factor,
      cx,
      cy,
      radius: radiusForScore(factor.score),
    };
  });

  return { width, height, bubbles };
}

// ============================================================
// 純粋関数: 線の線分算出
// ============================================================

/** 線の端とバブル外周の間に空ける隙間 (px)。 */
const LINE_GAP = 4;

/** バブル外周から外周へ引く 1 本の線。 */
export interface LinkSegment {
  link: MapLine;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * computeLinkSegments: 配置済みバブルと線の定義から、線分を算出する純粋関数。
 *
 * - 両端がマップ上にある線だけを対象にする。
 * - 線分はバブル中心ではなく外周から外周へ引く (文字と重ならない)。
 * - 2つのバブルが近すぎて線を引く長さが取れない場合は、その線を描かない。
 */
export function computeLinkSegments(
  bubbles: readonly BubbleLayout[],
  links: readonly MapLine[]
): LinkSegment[] {
  const byId = new Map<string, BubbleLayout>();
  for (const b of bubbles) byId.set(b.factor.id, b);

  const segments: LinkSegment[] = [];
  for (const link of links) {
    const a = byId.get(link.from);
    const b = byId.get(link.to);
    if (!a || !b) continue;

    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const dist = Math.hypot(dx, dy);
    if (dist <= a.radius + b.radius + LINE_GAP * 2) continue;

    const ux = dx / dist;
    const uy = dy / dist;
    segments.push({
      link,
      x1: a.cx + ux * (a.radius + LINE_GAP),
      y1: a.cy + uy * (a.radius + LINE_GAP),
      x2: b.cx - ux * (b.radius + LINE_GAP),
      y2: b.cy - uy * (b.radius + LINE_GAP),
    });
  }
  return segments;
}

// ============================================================
// MapRenderer
// ============================================================

/** render の任意オプション。 */
export interface MapRenderOptions {
  /** 円どうしを結ぶ線 (タイプの要因どうし)。省略時は線なし。 */
  links?: readonly MapLine[];
  /** 色を変える円 (タイプの要因) の id。省略時はどれも変えない。 */
  highlightIds?: readonly string[];
}

/** design.md Component 5 の契約 (options は後方互換の任意引数)。 */
export interface MapRenderer {
  render(
    container: HTMLElement,
    result: DiagnosisResult,
    options?: MapRenderOptions
  ): void;
}

/**
 * createMapRenderer: SVG ベースの MapRenderer を生成する。
 *
 * render は与えられた DiagnosisResult からのみ描画する純粋な振る舞いを持ち、
 * 同一 result に対して同一のマップ (バブル数・サイズ・配置・ラベル) を生成する。
 */
export function createMapRenderer(): MapRenderer {
  return {
    render(
      container: HTMLElement,
      result: DiagnosisResult,
      options?: MapRenderOptions
    ): void {
      renderMap(container, result, options);
    },
  };
}

/**
 * renderMap: container を初期化し、result.factors から SVG バブルマップを描画する。
 *
 * - factors の各要素に <circle> を1つ生成 (Req 10.1)
 * - 半径は radiusForScore による単調非減少 (Req 10.2)
 * - 各バブルに label テキストを重畳 (Req 10.3)
 * - グリッド配置で重なりを回避 (Req 10.3)
 * - 同期的に DOM を構築するため確定から即時完了 (Req 10.4)
 */
export function renderMap(
  container: HTMLElement,
  result: DiagnosisResult,
  options: MapRenderOptions = {}
): void {
  // 既存内容をクリアして冪等に再描画できるようにする。
  container.replaceChildren();

  const layout = computeLayout(result.factors);
  const segments = computeLinkSegments(layout.bubbles, options.links ?? []);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "moyamoya-map");
  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "診断マップ");
  svg.dataset.bubbleCount = String(layout.bubbles.length);

  // 線はバブルの下に描く (先に追加した要素が下になる)。
  for (const seg of segments) {
    svg.appendChild(createLinkLine(seg));
  }

  const highlight = new Set(options.highlightIds ?? []);
  for (const bubble of layout.bubbles) {
    svg.appendChild(
      createBubbleGroup(bubble, {
        isTop: bubble.factor.id === result.topFactorId,
        isType: highlight.has(bubble.factor.id),
      })
    );
  }

  container.appendChild(svg);
}

/** 線 1 本分の <line> を生成する。 */
function createLinkLine(seg: LinkSegment): SVGLineElement {
  const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
  line.setAttribute("x1", String(seg.x1));
  line.setAttribute("y1", String(seg.y1));
  line.setAttribute("x2", String(seg.x2));
  line.setAttribute("y2", String(seg.y2));
  line.setAttribute("class", "map-link");
  line.dataset.from = seg.link.from;
  line.dataset.to = seg.link.to;
  return line;
}

/** 1つのバブル (円 + ラベル) を表す <g> 要素を生成する。タイプの要因は色を変える。 */
function createBubbleGroup(
  bubble: BubbleLayout,
  flags: { isTop: boolean; isType: boolean }
): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g") as SVGGElement;
  const classes = ["bubble"];
  if (flags.isTop) classes.push("bubble--top");
  if (flags.isType) classes.push("bubble--type");
  group.setAttribute("class", classes.join(" "));
  group.dataset.factorId = bubble.factor.id;
  group.dataset.score = String(bubble.factor.score);

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(bubble.cx));
  circle.setAttribute("cy", String(bubble.cy));
  circle.setAttribute("r", String(bubble.radius));
  group.appendChild(circle);

  // ラベルをバブル上 (中心) に表示する (Req 10.3)。
  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", String(bubble.cx));
  label.setAttribute("y", String(bubble.cy));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "central");
  label.setAttribute("class", "bubble__label");
  label.textContent = bubble.factor.label;
  group.appendChild(label);

  return group;
}
