/**
 * 型分類 (タイプ判定)。
 *
 * 結果画面に表示する要因の数に応じて、タイプ名を次のように決める。
 *   - 1つ        : 10 タイプ (要因ごとの単独タイプ)
 *   - 2つ (複合) : 45 タイプ (10 要因から 2 つ選ぶ組み合わせ)
 *   - 3つ以上    : 120 タイプ (10 要因から 3 つ選ぶ組み合わせ)
 *
 * 組み合わせは順序を問わない。要因の固定順 (FACTOR_ORDER) に並べ替えたキーで引く。
 * 4つ表示される場合は、スコア上位 3 つで 120 タイプを引く (4 複合のタイプ定義は無い)。
 *
 * タイプ定義は src/data/moyamoya_175types.csv の 1 ファイル (単独・2複合・3複合の 175 件)。
 * 単独タイプ名 (要因詳細の見出しに出す Factor.typeName) もここが正。
 * 定義を直すときは CSV を差し替えるだけでよい。
 */

import type { Factor } from "@/models/types";
import typesCsv from "@/data/moyamoya_175types.csv?raw";

// ============================================================
// 要因の固定順と表示名 (CSV の要因名 → id)
// ============================================================

/**
 * 要因の固定順。CSV の並びおよび questions.json の factorMeta と同じ順にする。
 * label は CSV と questions.json の表記に完全一致させる。
 */
export const FACTOR_ORDER: readonly { id: string; label: string }[] = [
  { id: "time_margin", label: "時間・余白不足" },
  { id: "recovery", label: "回復不足" },
  { id: "info_overload", label: "情報過多/認知負荷" },
  { id: "comparison", label: "他者比較/自己評価の揺らぎ" },
  { id: "loneliness", label: "孤独/つながり不足" },
  { id: "future_uncertainty", label: "将来の不確実性/不安" },
  { id: "control", label: "コントロール感の低下" },
  { id: "ideal_gap", label: "理想と現実のギャップ" },
  { id: "rumination", label: "反すう/考え続ける状態" },
  { id: "indecision", label: "決められない/行動できない" },
];

const ID_BY_LABEL = new Map(FACTOR_ORDER.map((f) => [f.label, f.id]));
const ORDER_INDEX = new Map(FACTOR_ORDER.map((f, i) => [f.id, i]));

// ============================================================
// 型定義
// ============================================================

/** カタログ 1 件分のタイプ。 */
export interface TypeInfo {
  /** 組み合わせの要因 id (固定順) */
  factorIds: string[];
  /** CSV のタイプ名 (括弧・「タイプ」を除いた本体) */
  name: string;
  /** ひとこと解説 */
  description: string;
}

/** 判定結果。 */
export interface TypeResult {
  kind: "single" | "pair" | "triple";
  /** 判定に使った要因 id (固定順) */
  factorIds: string[];
  /** 画面に出すタイプ名 (括弧つき) */
  displayName: string;
  /** ひとこと解説 (単独タイプには無い) */
  description?: string;
}

/** 組み合わせキー → タイプ。 */
export type TypeCatalog = ReadonlyMap<string, TypeInfo>;

/** 要因数ごとのカタログ。 */
export interface TypeCatalogs {
  single: TypeCatalog;
  pair: TypeCatalog;
  triple: TypeCatalog;
}

/** CSV 1 行分 (要因数つき)。 */
export interface TypeRow extends TypeInfo {
  arity: 1 | 2 | 3;
}

// ============================================================
// キー・パース (純粋関数)
// ============================================================

/** 要因 id 群を固定順に並べ替えて返す。 */
export function sortByFactorOrder(ids: readonly string[]): string[] {
  return [...ids].sort(
    (a, b) => (ORDER_INDEX.get(a) ?? 999) - (ORDER_INDEX.get(b) ?? 999)
  );
}

/** 組み合わせのキー (固定順の id を "|" で連結)。 */
export function typeKey(ids: readonly string[]): string {
  return sortByFactorOrder(ids).join("|");
}

/** 「名前」タイプ → 名前。括弧や「タイプ」が無ければそのまま。 */
function coreName(raw: string): string {
  return raw
    .trim()
    .replace(/^「/, "")
    .replace(/」?タイプ$/, "")
    .replace(/」$/, "");
}

/**
 * parseTypeCsv: タイプ定義 CSV を TypeRow の配列に変換する。
 *
 * 列: No, 要因数, 要因1, 要因2, 要因3, タイプ名, 解説, (出典 など以降の列は無視)
 * 要因数が 1・2 の行は、使わない要因列を空にする。解説は空でもよい。
 * 先頭の BOM と空行は無視する。要因数が不正、要因名が未知、列が足りない、要因が重複する、
 * タイプ名が空の行は例外にする (定義ミスを画面で気づかず通さないため)。
 *
 * @param raw CSV 全体の文字列
 */
export function parseTypeCsv(raw: string): TypeRow[] {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  const NEED = 7; // No, 要因数, 要因1..3, タイプ名, 解説
  const rows: TypeRow[] = [];
  // 先頭行はヘッダ。
  for (let i = 1; i < lines.length; i++) {
    const at = `タイプ定義 ${i + 1} 行目`;
    const cols = lines[i].split(",");
    if (cols.length < NEED) {
      throw new Error(`${at}: 列が足りません (${cols.length}/${NEED})`);
    }
    const arity = Number(cols[1].trim());
    if (arity !== 1 && arity !== 2 && arity !== 3) {
      throw new Error(`${at}: 要因数が不正です「${cols[1]}」`);
    }
    const ids: string[] = [];
    for (let k = 0; k < 3; k++) {
      const label = cols[2 + k].trim();
      if (k >= arity) {
        if (label) throw new Error(`${at}: 要因数 ${arity} なのに要因${k + 1}があります`);
        continue;
      }
      const id = ID_BY_LABEL.get(label);
      if (id === undefined) {
        throw new Error(`${at}: 未知の要因名「${label}」`);
      }
      ids.push(id);
    }
    if (new Set(ids).size !== arity) {
      throw new Error(`${at}: 要因が重複しています`);
    }
    const name = coreName(cols[5]);
    if (!name) throw new Error(`${at}: タイプ名が空です`);
    rows.push({
      arity,
      factorIds: sortByFactorOrder(ids),
      name,
      description: cols[6].trim(),
    });
  }
  return rows;
}

/** TypeRow 群を要因数ごとのカタログに分ける。 */
export function buildCatalogs(rows: readonly TypeRow[]): TypeCatalogs {
  return {
    single: buildCatalog(rows.filter((r) => r.arity === 1)),
    pair: buildCatalog(rows.filter((r) => r.arity === 2)),
    triple: buildCatalog(rows.filter((r) => r.arity === 3)),
  };
}

/** TypeInfo 群からカタログを作る。同じ組み合わせが重複したら例外にする。 */
export function buildCatalog(rows: readonly TypeInfo[]): Map<string, TypeInfo> {
  const map = new Map<string, TypeInfo>();
  for (const row of rows) {
    const key = typeKey(row.factorIds);
    if (map.has(key)) {
      throw new Error(`タイプ定義: 組み合わせが重複しています (${key})`);
    }
    map.set(key, row);
  }
  return map;
}

// ============================================================
// 既定カタログ (CSV から一度だけ構築)
// ============================================================

let defaultCatalogs: TypeCatalogs | undefined;

function getDefaultCatalogs(): TypeCatalogs {
  defaultCatalogs ??= buildCatalogs(parseTypeCsv(typesCsv));
  return defaultCatalogs;
}

/**
 * singleTypeName: 要因 id の単独タイプ名 (括弧なし) を返す。定義が無ければ undefined。
 * 要因詳細の見出しに出す Factor.typeName の出どころ。
 */
export function singleTypeName(
  factorId: string,
  catalogs: TypeCatalogs = getDefaultCatalogs()
): string | undefined {
  return catalogs.single.get(factorId)?.name;
}

// ============================================================
// 判定
// ============================================================

/**
 * classifyType: 画面に表示する要因からタイプを判定する純粋関数。
 *
 * @param displayFactors 表示対象の要因 (score 降順。先頭が 1 位)
 * @param catalogs       テスト用の差し替え口。省略時は CSV から作った既定カタログ
 * @returns 判定結果。要因が空のときは null
 */
export function classifyType(
  displayFactors: readonly Factor[],
  catalogs: TypeCatalogs = getDefaultCatalogs()
): TypeResult | null {
  if (displayFactors.length === 0) return null;
  const top = displayFactors[0];

  // 3つ以上は上位3つ、2つは上位2つで引く。
  if (displayFactors.length >= 3) {
    const ids = sortByFactorOrder(displayFactors.slice(0, 3).map((f) => f.id));
    const hit = catalogs.triple.get(typeKey(ids));
    if (hit) {
      return {
        kind: "triple",
        factorIds: hit.factorIds,
        displayName: `『${hit.name}』`,
        description: hit.description,
      };
    }
  } else if (displayFactors.length === 2) {
    const ids = sortByFactorOrder(displayFactors.map((f) => f.id));
    const hit = catalogs.pair.get(typeKey(ids));
    if (hit) {
      return {
        kind: "pair",
        factorIds: hit.factorIds,
        displayName: `『${hit.name}』タイプ`,
        description: hit.description,
      };
    }
  }

  // 1つだけ、または定義が見つからないときは 1 位の単独タイプにする。
  const single = catalogs.single.get(top.id);
  return {
    kind: "single",
    factorIds: [top.id],
    displayName: single ? `『${single.name}』タイプ` : top.label,
    ...(single?.description ? { description: single.description } : {}),
  };
}
