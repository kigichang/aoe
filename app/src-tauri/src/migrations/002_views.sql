-- View：跨主題的欄位組合。內建的（每主題一個，id = 主題 slug，builtin = 1）
-- 在每次重建上游表時同步；使用者建的永久保留。
CREATE TABLE views (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  min_year    INTEGER NOT NULL,
  max_year    INTEGER NOT NULL,
  default_ppy REAL,
  order_no    REAL,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE view_columns (
  view_id           TEXT NOT NULL REFERENCES views(id) ON DELETE CASCADE,
  order_no          INTEGER NOT NULL,
  topic             TEXT NOT NULL,
  region            TEXT NOT NULL,
  -- 各主題的 importance 尺規定義不同（taiwan 的 5 是「台灣史最重要」），
  -- 跨主題並列時每欄可加減 -2…+2 再夾在 1…5
  importance_offset INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (view_id, order_no)
);
