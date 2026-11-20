/**
 * タイプ定義 (175件) の読み込みと引き当て。
 *
 * タイプはバックエンド (API-02) が決める。画面は result_type_id ("05" / "03-09" / "03-05-09") で
 * タイプ名・ひとこと解説を引くだけ。
 *
 * 定義の元データは src/data/moyamoya_175types.csv。文言はまだ「案」なので、CSV を直したら
 * `npm run build:types` で public/types.json を作り直す (scripts/build-types.mjs)。
 * 起動時に types.json を読み込み、175件 (1つ10・2つ45・3つ120) がそろっているか確かめる。
 */

/** 分類の数 (分類ID 1〜10)。 */
export const CATEGORY_COUNT = 10;

/** タイプにする分類の最大数。 */
export const TYPE_MAX = 3;

/** タイプ 1 件分。 */
export interface TypeEntry {
  /** タイプ名 (括弧なし) */
  name: string;
  /** ひとこと解説 (単独タイプなどは空のことがある) */
  description: string;
}

/** タイプID → タイプ。 */
export type TypeCatalog = ReadonlyMap<string, TypeEntry>;

/** 分類IDの並び → タイプID (小さい順に2桁でつなぐ。例: [9, 3] → "03-09")。 */
export function typeIdOf(categoryIds: readonly number[]): string {
  return [...categoryIds]
    .sort((a, b) => a - b)
    .map((c) => String(c).padStart(2, "0"))
    .join("-");
}

/** タイプID → 分類IDの並び ("03-09" → [3, 9])。 */
export function categoryIdsOf(typeId: string): number[] {
  return typeId.split("-").map(Number);
}

/** 1〜3 個の組み合わせのタイプID 全175件。 */
export function allTypeIds(): string[] {
  const ids: string[] = [];
  const walk = (start: number, picked: number[], size: number): void => {
    if (picked.length === size) {
      ids.push(typeIdOf(picked));
      return;
    }
    for (let c = start; c <= CATEGORY_COUNT; c++) walk(c + 1, [...picked, c], size);
  };
  for (let size = 1; size <= TYPE_MAX; size++) walk(1, [], size);
  return ids;
}

/**
 * parseTypeCatalog: types.json の中身を検証してカタログにする。
 *
 * 175件のタイプID がすべてそろい、それぞれにタイプ名があることを確かめる。
 * (API の circles / type_categories から作ったIDが必ず見つかるようにするため)
 * 足りない・余計なID・形の誤りがあれば、まとめて例外にする。
 */
export function parseTypeCatalog(json: unknown): TypeCatalog {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("types.json の形が正しくありません (オブジェクトではない)");
  }
  const obj = json as Record<string, unknown>;
  const expected = allTypeIds();
  const errors: string[] = [];
  const catalog = new Map<string, TypeEntry>();

  for (const id of expected) {
    const v = obj[id];
    if (v === undefined) {
      errors.push(`${id}: ありません`);
      continue;
    }
    const e = v as Record<string, unknown>;
    if (typeof e?.name !== "string" || e.name.trim() === "") {
      errors.push(`${id}: タイプ名がありません`);
      continue;
    }
    catalog.set(id, {
      name: e.name,
      description: typeof e.description === "string" ? e.description : "",
    });
  }
  const known = new Set(expected);
  const extra = Object.keys(obj).filter((id) => !known.has(id));
  if (extra.length > 0) errors.push(`不正なタイプID: ${extra.join(", ")}`);

  if (errors.length > 0) {
    throw new Error(`types.json のタイプ定義に誤りがあります (${errors.length}件)\n  ${errors.join("\n  ")}`);
  }
  return catalog;
}

/** loadTypeCatalog: public/types.json を読み込んで検証する。 */
export async function loadTypeCatalog(
  fetchFn: typeof fetch = fetch
): Promise<TypeCatalog> {
  const res = await fetchFn("/types.json", { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`types.json の読み込みに失敗しました (status: ${res.status})`);
  }
  return parseTypeCatalog(await res.json());
}

/**
 * 画面に出すタイプ名。1つ・2つの組み合わせは『名前』タイプ、3つは『名前』。
 * (3つのタイプ名は「〜さん」「〜家」など人の呼び名になっているため)
 */
export function typeDisplayName(typeId: string, entry: TypeEntry): string {
  return categoryIdsOf(typeId).length >= 3 ? `『${entry.name}』` : `『${entry.name}』タイプ`;
}
