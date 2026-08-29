-- 上游（唯讀）資料表。每次同步整批重建；使用者資料表（後續 migration 加）永遠不動。
-- 事件主鍵 ref = "{topic}/{region}/{id}"：事件 id 只在單一 region 檔內唯一，
-- 而且 taiwan 與 world 刻意共用 tw-* id 但兩份獨立維護。

CREATE TABLE bundle_meta (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  version     TEXT NOT NULL,
  sha256      TEXT,
  built_at    TEXT,
  imported_at TEXT NOT NULL
);

CREATE TABLE topics (
  slug         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  title        TEXT,
  description  TEXT NOT NULL,
  column_label TEXT NOT NULL,
  jumps_json   TEXT,
  default_ppy  REAL,
  order_no     REAL,
  root         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE timelines (
  topic    TEXT PRIMARY KEY REFERENCES topics(slug) ON DELETE CASCADE,
  min_year INTEGER NOT NULL,
  max_year INTEGER NOT NULL
);

CREATE TABLE categories (
  topic    TEXT NOT NULL REFERENCES topics(slug) ON DELETE CASCADE,
  id       TEXT NOT NULL,
  label    TEXT NOT NULL,
  glyph    TEXT NOT NULL,
  order_no INTEGER NOT NULL,
  PRIMARY KEY (topic, id)
);

CREATE TABLE regions (
  topic    TEXT NOT NULL REFERENCES topics(slug) ON DELETE CASCADE,
  id       TEXT NOT NULL,
  name     TEXT NOT NULL,
  subtitle TEXT,
  order_no INTEGER NOT NULL,
  PRIMARY KEY (topic, id)
);

CREATE TABLE periods (
  topic  TEXT NOT NULL,
  region TEXT NOT NULL,
  id     TEXT NOT NULL,
  name   TEXT NOT NULL,
  track  INTEGER NOT NULL DEFAULT 0,
  start  INTEGER NOT NULL,
  end    INTEGER NOT NULL,
  note   TEXT,
  PRIMARY KEY (topic, region, id),
  FOREIGN KEY (topic, region) REFERENCES regions(topic, id) ON DELETE CASCADE
);

CREATE TABLE events (
  ref          TEXT PRIMARY KEY,
  topic        TEXT NOT NULL,
  region       TEXT NOT NULL,
  id           TEXT NOT NULL,
  year         INTEGER NOT NULL,
  end_year     INTEGER,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  importance   INTEGER NOT NULL,
  desc         TEXT,
  legendary    INTEGER,
  actual_year  INTEGER,
  sources_json TEXT,
  links_json   TEXT,
  FOREIGN KEY (topic, region) REFERENCES regions(topic, id) ON DELETE CASCADE
);
CREATE INDEX events_by_region ON events(topic, region, year);
CREATE INDEX events_by_year ON events(year);
