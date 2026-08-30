-- 題庫。kind：choice（單選）／year（年份，容錯 ±N）／order（排序）／flash（問答，自評）。
-- options_json／answer_json 依 kind 而異，形狀定義在 model.rs 的 Question。
CREATE TABLE questions (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  answer_json  TEXT NOT NULL,
  explanation  TEXT,
  source_file  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE question_events (
  question_id    TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  event_ref      TEXT NOT NULL,
  title_snapshot TEXT NOT NULL,
  PRIMARY KEY (question_id, event_ref)
);
CREATE INDEX question_events_by_event ON question_events(event_ref);

-- SM-2。lapses > 0 就進錯題本。due_at 為 NULL 表示還沒複習過（視為到期）。
CREATE TABLE review_state (
  question_id   TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  ease          REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  due_at        TEXT,
  reps          INTEGER NOT NULL DEFAULT 0,
  lapses        INTEGER NOT NULL DEFAULT 0,
  last_grade    INTEGER
);

CREATE TABLE review_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  grade       INTEGER NOT NULL,
  elapsed_ms  INTEGER
);
