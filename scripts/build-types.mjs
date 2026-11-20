/**
 * タイプ定義 CSV (175件) → public/types.json
 *
 * 使い方:
 *   npm run build:types              CSV から public/types.json を作り直す (types.json もコミットする)
 *   npm run build:types -- --check   types.json が CSV と一致しているかだけ確かめる (一致しなければ終了コード 1)
 *   node scripts/build-types.mjs <CSVのパス>   別の CSV (例: 20_タイプ決め/moyamoya_175types.csv) から作る
 *
 * 列は見出しの名前で探す (正本の列名とアプリ内の CSV の列名のどちらにも対応する)。
 *   - タイプID              : "05" / "03-09" / "03-05-09" (分類IDを小さい順に2桁でつないだもの)。
 *                             列が無ければ 要因1〜要因3 の表示名から作る
 *   - タイプ名(案) / タイプ名
 *   - ひとこと解説(案) / 解説  (空でもよい)
 * 分類ID は public/questions.json の factorMeta の並び順 (1番目 = 分類ID 1)。
 *
 * 出力: { "03-09": { "name": "…", "description": "…" }, … }  (175件。足りない・重複があれば失敗する)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CSV = resolve(ROOT, "src/data/moyamoya_175types.csv");
const OUT = resolve(ROOT, "public/types.json");
const QUESTIONS = resolve(ROOT, "public/questions.json");
const CATEGORY_COUNT = 10;
const MAX_ARITY = 3;

/** CSV を行×列に分ける (ダブルクォートで囲んだ値の中のカンマ・改行にも対応)。 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** 分類IDの並び → タイプID ("03-09" など)。 */
export function typeIdOf(categoryIds) {
  return [...categoryIds]
    .sort((a, b) => a - b)
    .map((c) => String(c).padStart(2, "0"))
    .join("-");
}

/** 1〜3 個の組み合わせのタイプID 全175件 (1つ→2つ→3つ の順)。 */
export function allTypeIds() {
  const ids = [];
  const walk = (start, picked, size) => {
    if (picked.length === size) {
      ids.push(typeIdOf(picked));
      return;
    }
    for (let c = start; c <= CATEGORY_COUNT; c++) walk(c + 1, [...picked, c], size);
  };
  for (let size = 1; size <= MAX_ARITY; size++) walk(1, [], size);
  return ids;
}

/** 「名前」タイプ → 名前。括弧や「タイプ」が無ければそのまま。 */
function coreName(raw) {
  return raw.trim().replace(/^「/, "").replace(/」?タイプ$/, "").replace(/」$/, "");
}

/** CSV の文字列 → [タイプID, { name, description }] の並び (175件)。定義に誤りがあれば例外。 */
export function csvToTypes(csvText, factorLabels) {
  const rows = parseCsv(csvText.replace(/^﻿/, ""));
  const header = rows[0].map((h) => h.trim());
  const col = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const idCol = col("タイプID");
  const nameCol = col("タイプ名(案)", "タイプ名");
  const descCol = col("ひとこと解説(案)", "解説");
  const factorCols = [col("要因1"), col("要因2"), col("要因3")];
  if (nameCol < 0) throw new Error("CSV に「タイプ名(案)」または「タイプ名」の列がありません");
  if (idCol < 0 && factorCols[0] < 0) throw new Error("CSV に「タイプID」または「要因1」の列がありません");

  const categoryByLabel = new Map(factorLabels.map((label, i) => [label, i + 1]));
  const types = {};
  const errors = [];

  rows.slice(1).forEach((r, i) => {
    const at = `${i + 2} 行目`;
    const cell = (c) => (c >= 0 ? (r[c] ?? "").trim() : "");

    // 要因列から作ったタイプID (要因列があるとき)
    let fromFactors;
    if (factorCols[0] >= 0) {
      const labels = factorCols.map(cell).filter((v) => v !== "");
      const cats = labels.map((l) => categoryByLabel.get(l));
      const unknown = labels.filter((_, k) => cats[k] === undefined);
      if (unknown.length > 0) {
        errors.push(`${at}: 未知の要因名 ${unknown.map((u) => `「${u}」`).join("")}`);
        return;
      }
      if (new Set(cats).size !== cats.length) {
        errors.push(`${at}: 要因が重複しています`);
        return;
      }
      fromFactors = typeIdOf(cats);
    }

    const id = idCol >= 0 ? cell(idCol) : fromFactors;
    if (!id) {
      errors.push(`${at}: タイプID がありません`);
      return;
    }
    if (fromFactors && fromFactors !== id) {
      errors.push(`${at}: タイプID ${id} と要因列 (${fromFactors}) が合いません`);
      return;
    }
    if (id in types) {
      errors.push(`${at}: タイプID ${id} が重複しています`);
      return;
    }
    const name = coreName(cell(nameCol));
    if (!name) {
      errors.push(`${at}: タイプ名が空です`);
      return;
    }
    types[id] = { name, description: cell(descCol) };
  });

  const expected = allTypeIds();
  const missing = expected.filter((id) => !(id in types));
  const extra = Object.keys(types).filter((id) => !expected.includes(id));
  if (missing.length > 0) errors.push(`足りないタイプID (${missing.length}件): ${missing.join(", ")}`);
  if (extra.length > 0) errors.push(`不正なタイプID: ${extra.join(", ")}`);
  if (errors.length > 0) throw new Error(`タイプ定義に誤りがあります\n  ${errors.join("\n  ")}`);

  // 1つ→2つ→3つ、ID の小さい順に並べる (差分を読みやすくするため)
  return expected.map((id) => [id, types[id]]);
}

/**
 * [タイプID, 定義] の並び → JSON 文字列。
 * "10" のような数字だけのキーはオブジェクトに入れると先頭に並び替わるので、並びを保って手で組み立てる。
 */
export function typesToJson(entries) {
  const body = entries
    .map(([id, t]) => `  ${JSON.stringify(id)}: ${JSON.stringify(t, null, 2).replace(/\n/g, "\n  ")}`)
    .join(",\n");
  return `{\n${body}\n}\n`;
}

function main(argv) {
  const check = argv.includes("--check");
  const csvPath = resolve(argv.find((a) => !a.startsWith("--")) ?? DEFAULT_CSV);

  const labels = JSON.parse(readFileSync(QUESTIONS, "utf-8")).factorMeta.map((m) => m.label);
  const types = csvToTypes(readFileSync(csvPath, "utf-8"), labels);
  const json = typesToJson(types);

  if (check) {
    let current = "";
    try {
      current = readFileSync(OUT, "utf-8");
    } catch {
      // 無ければ不一致
    }
    if (current !== json) {
      console.error("public/types.json が CSV と一致しません。npm run build:types で作り直してください。");
      process.exit(1);
    }
    console.log(`public/types.json は CSV と一致しています (${types.length}件)`);
    return;
  }

  writeFileSync(OUT, json, "utf-8");
  console.log(`${csvPath} → public/types.json (${types.length}件)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
