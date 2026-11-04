-- Migration: 0001_init
-- もやもや診断アプリ (moyamoya-diagnosis-app) 研究データ用スキーマ
-- Cloudflare D1 (SQLite)
-- 参照: design.md「D1 データベーススキーマ」
-- 関連要件: 4.5 (事前アンケート保存), 9.7 (診断結果保存), 12.5 (事後アンケート保存)

-- 研究セッション（匿名ID単位）
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,          -- UUID (クライアント生成)
  consented    INTEGER NOT NULL,          -- 利用同意 F-03 (0/1)
  consent_at   TEXT,                      -- 同意日時 ISO8601
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 事前アンケート F-04 (Requirement 4.5)
CREATE TABLE IF NOT EXISTS pre_survey (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  clarity      INTEGER NOT NULL,          -- 1..5
  free_text    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 診断結果 F-11 (Requirement 9.7)
CREATE TABLE IF NOT EXISTS diagnosis (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  answers_json TEXT NOT NULL,             -- {"q1":"0",...,"q20":"4"}
  result_json  TEXT NOT NULL,             -- DiagnosisResult を JSON 化
  top_factor   TEXT NOT NULL,             -- 集計の便宜 (F-18後回しに備える)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 事後アンケート F-14 (Requirement 12.5)
CREATE TABLE IF NOT EXISTS post_survey (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  clarity      INTEGER NOT NULL,          -- 1..5
  conviction   INTEGER NOT NULL,          -- 納得度 1..5
  free_text    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- インデックス（セッション単位の照会・集計用）
CREATE INDEX IF NOT EXISTS idx_pre_session  ON pre_survey(session_id);
CREATE INDEX IF NOT EXISTS idx_diag_session ON diagnosis(session_id);
CREATE INDEX IF NOT EXISTS idx_post_session ON post_survey(session_id);
