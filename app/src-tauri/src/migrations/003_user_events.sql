-- 使用者自己加的事件。ref = "user/<uuid>"，跟上游事件的 "{topic}/{region}/{id}" 不會撞。
-- 一則事件可以放到多個主題的欄位上（placement）；category 掛在 placement 上，
-- 因為每個主題的類別表不同（世界史是「政治」，科學史是「發現」）。
CREATE TABLE user_events (
  ref          TEXT PRIMARY KEY,
  year         INTEGER NOT NULL,
  end_year     INTEGER,
  title        TEXT NOT NULL,
  desc         TEXT,
  importance   INTEGER NOT NULL DEFAULT 3,
  legendary    INTEGER NOT NULL DEFAULT 0,
  sources_json TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE event_placements (
  event_ref TEXT NOT NULL REFERENCES user_events(ref) ON DELETE CASCADE,
  topic     TEXT NOT NULL,
  region    TEXT NOT NULL,
  category  TEXT NOT NULL,
  PRIMARY KEY (event_ref, topic, region)
);
CREATE INDEX placements_by_column ON event_placements(topic, region);
