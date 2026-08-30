-- Tag：有分組、可有父子層級。event_ref 指向上游事件（"{topic}/{region}/{id}"）或使用者事件
-- （"user/…"），對上游刻意不設 FK —— 上游表每次同步整批重建。title_snapshot 讓 ref 失效
--（上游改 id 或刪除）之後，孤兒檢查列出來時人還讀得懂。
CREATE TABLE tag_groups (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  order_no INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id        TEXT PRIMARY KEY,
  group_id  TEXT REFERENCES tag_groups(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  name      TEXT NOT NULL,
  color     TEXT,
  order_no  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE event_tags (
  event_ref      TEXT NOT NULL,
  tag_id         TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  title_snapshot TEXT NOT NULL,
  PRIMARY KEY (event_ref, tag_id)
);
CREATE INDEX event_tags_by_tag ON event_tags(tag_id);

-- 有向關聯。kind 是自由字串，UI 給預設：導致／回應／延續／對照
CREATE TABLE event_links (
  id             TEXT PRIMARY KEY,
  from_ref       TEXT NOT NULL,
  to_ref         TEXT NOT NULL,
  kind           TEXT NOT NULL,
  note           TEXT,
  snapshot_from  TEXT NOT NULL,
  snapshot_to    TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX links_from ON event_links(from_ref);
CREATE INDEX links_to ON event_links(to_ref);
