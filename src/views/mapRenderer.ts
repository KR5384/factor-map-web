/**
 * MapRenderer (診断マップ描画): 要因を円で表し、タイプの要因どうしを線で結んだマップを描画する。
 *
 * design.md「Component 5: MapRenderer」に準拠。
 *   interface MapRenderer { render(container: HTMLElement, result: DiagnosisResult): void; }
 *
 * 要件対応 (F-12 / Requirement 10):
 *   - 10.1 factors の各要素に1つのバブルを対応付け、バブル総数を factors 要素数と一致させる
 *   - 10.2 バブルサイズを score (0..100) に対して単調非減少に決定する
 *   - 10.3 各バブルに短いラベルと点数を表示し、いずれのバブルも重ならないよう配置する
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

/** バブル半径の下限・上限 (px)。score=0 で MIN、score=100 で MAX。ラベルと点数の2行が収まる大きさ。 */
export const BUBBLE_RADIUS_MIN = 40;
export const BUBBLE_RADIUS_MAX = 58;

/** 線で結ばない円どうしの最小間隔 (px)。 */
const BUBBLE_GAP = 10;

/** 線で結ぶ円どうしの間隔 (px)。線が見える長さを取る。 */
const LINKED_GAP = 34;

/** マップ外周の余白 (px)。 */
const MAP_PADDING = 6;

/** 残りの円を置く場所を探すときの刻み (距離 px / 角度 度)。 */
const SEARCH_STEP = 4;
const SEARCH_ANGLE_STEP = 10;
const SEARCH_MAX_DISTANCE = 2000;

/** 残りの円を優先して置く向き (度。0=右、90=下)。左側から埋める。 */
const PREFERRED_ANGLE = 180;

// ============================================================
// 純粋関数: score → 半径 / 短いラベル
// ============================================================

/**
 * radiusForScore: score (0..100) をバブル半径 (px) へ線形写像する純粋関数。
 *
 * 性質:
 *   - score に対して単調非減少 (Req 10.2)。a.score >= b.score ⇒ radius(a) >= radius(b)
 *   - 常に [BUBBLE_RADIUS_MIN, BUBBLE_RADIUS_MAX] の範囲に収まる
 *   - 範囲外の score は 0..100 にクランプしてから写像する (安全側)
 */
export function radiusForScore(score: number): number {
  const clamped = Math.max(SCORE_MIN, Math.min(SCORE_MAX, score));
  const ratio = clamped / (SCORE_MAX - SCORE_MIN); // 0..1
  return BUBBLE_RADIUS_MIN + ratio * (BUBBLE_RADIUS_MAX - BUBBLE_RADIUS_MIN);
}

/** 円に出す短いラベル (表示名の「/」より前。例: 「反すう/考え続ける状態」→「反すう」)。 */
export function shortLabel(label: string): string {
  const head = label.split("/")[0]?.trim();
  return head ? head : label;
}

// ============================================================
// 純粋関数: レイアウト算出
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

/** computeLayout の任意オプション。 */
export interface LayoutOptions {
  /** 中央に寄せる円 (タイプの要因) の id。省略時・該当なしは先頭の円を中央に置く。 */
  clusterIds?: readonly string[];
  /** 円どうしを結ぶ線。残りの円は線の上に重ならないように置く。 */
  links?: readonly MapLine[];
}

interface Point {
  x: number;
  y: number;
}

/** 点 p と線分 ab の距離。 */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * タイプの円 (1〜3つ) を寄せて置く。どの2つも LINKED_GAP だけ離して線が見えるようにする。
 *   1つ: 原点 / 2つ: 右下がりに並べる / 3つ: 1つ目を上にした三角形 (2つ目が右下、3つ目が左下)
 */
function placeCluster(radii: readonly number[]): Point[] {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const d = (i: number, j: number) => radii[i]! + radii[j]! + LINKED_GAP;

  if (radii.length === 1) return [{ x: 0, y: 0 }];
  if (radii.length === 2) {
    const a = rad(35);
    return [
      { x: 0, y: 0 },
      { x: d(0, 1) * Math.cos(a), y: d(0, 1) * Math.sin(a) },
    ];
  }

  // A=(0,0)、B=(dAB,0) とし、余弦定理で C を求めてから 60° 回す。
  const dab = d(0, 1);
  const dac = d(0, 2);
  const dbc = d(1, 2);
  const cx = (dab * dab + dac * dac - dbc * dbc) / (2 * dab);
  const cy = Math.sqrt(Math.max(0, dac * dac - cx * cx));
  const rot = rad(60);
  const turn = (p: Point): Point => ({
    x: p.x * Math.cos(rot) - p.y * Math.sin(rot),
    y: p.x * Math.sin(rot) + p.y * Math.cos(rot),
  });
  return [{ x: 0, y: 0 }, turn({ x: dab, y: 0 }), turn({ x: cx, y: cy })];
}

/**
 * computeLayout: factors から重なりのない配置を算出する純粋関数。
 *
 * - タイプの円 (clusterIds) を中央に寄せ、線で結べる距離を取って置く。
 * - 残りの円は factors の順に、置いた円とも線とも重ならない場所のうち中央にいちばん近い所へ置く (Req 10.3)。
 * - バブル総数は factors 要素数と常に一致する (Req 10.1)。
 * - 乱数を使わないので、同じ入力からは同じ配置になる。
 *
 * @param factors 描画対象の要因 (DiagnosisResult.factors の並び順を維持)
 */
export function computeLayout(factors: Factor[], options: LayoutOptions = {}): MapLayout {
  if (factors.length === 0) {
    return { width: 0, height: 0, bubbles: [] };
  }

  const clusterSet = new Set(options.clusterIds ?? []);
  let cluster = factors.filter((f) => clusterSet.has(f.id)).slice(0, 3);
  if (cluster.length === 0) cluster = [factors[0]!];
  const clusterIdSet = new Set(cluster.map((f) => f.id));

  const placed = new Map<string, { p: Point; r: number }>();
  const clusterRadii = cluster.map((f) => radiusForScore(f.score));
  placeCluster(clusterRadii).forEach((p, i) => {
    placed.set(cluster[i]!.id, { p, r: clusterRadii[i]! });
  });

  // 中央 = タイプの円の重心。
  const center: Point = { x: 0, y: 0 };
  for (const { p } of placed.values()) {
    center.x += p.x / placed.size;
    center.y += p.y / placed.size;
  }

  const fits = (p: Point, r: number): boolean => {
    for (const other of placed.values()) {
      if (Math.hypot(p.x - other.p.x, p.y - other.p.y) < r + other.r + BUBBLE_GAP) return false;
    }
    for (const link of options.links ?? []) {
      const a = placed.get(link.from);
      const b = placed.get(link.to);
      if (a && b && distanceToSegment(p, a.p, b.p) < r + BUBBLE_GAP) return false;
    }
    return true;
  };

  // 角度は好みの向きに近い順に試す (180, 170, 190, 160, 200, ...)。
  const angles: number[] = [PREFERRED_ANGLE];
  for (let k = SEARCH_ANGLE_STEP; k <= 180; k += SEARCH_ANGLE_STEP) {
    angles.push(PREFERRED_ANGLE - k);
    if (k < 180) angles.push(PREFERRED_ANGLE + k);
  }

  for (const factor of factors) {
    if (clusterIdSet.has(factor.id)) continue;
    const r = radiusForScore(factor.score);
    let spot: Point | undefined;
    for (let dist = 0; dist <= SEARCH_MAX_DISTANCE && !spot; dist += SEARCH_STEP) {
      for (const deg of angles) {
        const a = (deg * Math.PI) / 180;
        const p = { x: center.x + dist * Math.cos(a), y: center.y + dist * Math.sin(a) };
        if (fits(p, r)) {
          spot = p;
          break;
        }
      }
    }
    // 探索範囲内で必ず見つかるが、念のため右端の外に置く。
    if (!spot) {
      const right = Math.max(...[...placed.values()].map((o) => o.p.x + o.r));
      spot = { x: right + BUBBLE_GAP + r, y: center.y };
    }
    placed.set(factor.id, { p: spot, r });
  }

  // 全体を囲む枠に合わせて平行移動する。
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { p, r } of placed.values()) {
    minX = Math.min(minX, p.x - r);
    minY = Math.min(minY, p.y - r);
    maxX = Math.max(maxX, p.x + r);
    maxY = Math.max(maxY, p.y + r);
  }
  const offsetX = MAP_PADDING - minX;
  const offsetY = MAP_PADDING - minY;

  const bubbles: BubbleLayout[] = factors.map((factor) => {
    const { p, r } = placed.get(factor.id)!;
    return { factor, cx: p.x + offsetX, cy: p.y + offsetY, radius: r };
  });

  return {
    width: Math.ceil(maxX - minX + MAP_PADDING * 2),
    height: Math.ceil(maxY - minY + MAP_PADDING * 2),
    bubbles,
  };
}

// ============================================================
// 純粋関数: 線の線分算出
// ============================================================

/** 円の中心から中心へ引く 1 本の線。 */
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
 * - 線分は円の中心どうしを結ぶ。円は塗りつぶして線の上に描くので、見えるのは円と円の間だけで文字とは重ならない。
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
    if (!a || !b || a === b) continue;
    segments.push({ link, x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy });
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
 * - 各バブルに短いラベルと点数を重畳 (Req 10.3)
 * - タイプの円を中央に寄せ、残りは空いた場所へ置いて重なりを回避 (Req 10.3)
 * - 同期的に DOM を構築するため確定から即時完了 (Req 10.4)
 */
export function renderMap(
  container: HTMLElement,
  result: DiagnosisResult,
  options: MapRenderOptions = {}
): void {
  // 既存内容をクリアして冪等に再描画できるようにする。
  container.replaceChildren();

  const links = options.links ?? [];
  const layout = computeLayout(result.factors, { clusterIds: options.highlightIds, links });
  const segments = computeLinkSegments(layout.bubbles, links);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "moyamoya-map");
  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", describeMap(result.factors, options.highlightIds ?? []));
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

/**
 * describeMap: マップの代替テキスト。
 * role="img" の SVG は中の文字が読み上げられないので、円の内容 (要因と点数) と
 * どれがタイプの要因かを文章にして aria-label に入れる。
 */
export function describeMap(factors: readonly Factor[], highlightIds: readonly string[]): string {
  const items = factors.map((f) => `${f.label} ${formatScore(f.score)}点`).join("、");
  const highlight = new Set(highlightIds);
  const typeLabels = factors.filter((f) => highlight.has(f.id)).map((f) => f.label);
  const typePart = typeLabels.length > 0 ? `タイプを決めた要因は ${typeLabels.join("、")}。` : "";
  return `診断マップ。${items}。${typePart}`;
}

/** 点数の表示 (整数に丸める)。 */
function formatScore(score: number): string {
  return String(Math.round(score));
}

/** 1つのバブル (円 + ラベル + 点数) を表す <g> 要素を生成する。タイプの要因は色を変える。 */
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

  // 読み上げ用に、省略しない表示名と点数を添える。
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = `${bubble.factor.label} ${formatScore(bubble.factor.score)}点`;
  group.appendChild(title);

  // 短いラベルと点数を2行でバブル中央に表示する (Req 10.3)。
  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", String(bubble.cx));
  label.setAttribute("y", String(bubble.cy - 9));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "central");
  label.setAttribute("class", "bubble__label");
  label.setAttribute("aria-hidden", "true");
  label.textContent = shortLabel(bubble.factor.label);
  group.appendChild(label);

  const score = document.createElementNS(SVG_NS, "text");
  score.setAttribute("x", String(bubble.cx));
  score.setAttribute("y", String(bubble.cy + 11));
  score.setAttribute("text-anchor", "middle");
  score.setAttribute("dominant-baseline", "central");
  score.setAttribute("class", "bubble__score");
  score.setAttribute("aria-hidden", "true");
  score.textContent = formatScore(bubble.factor.score);
  group.appendChild(score);

  return group;
}
