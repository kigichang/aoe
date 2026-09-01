//! SQLite 存取。開發期每次啟動從 repo YAML 重建上游表；使用者表（之後的 migration）不動。

use crate::model::*;
use anyhow::{anyhow, bail, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use std::path::Path;

/// 只能往後加，不能改既有的一支 —— 使用者機器上的資料庫已經套過了。
const MIGRATIONS: &[M<'static>] = &[
    M::up(include_str!("migrations/001_upstream.sql")),
    M::up(include_str!("migrations/002_views.sql")),
    M::up(include_str!("migrations/003_user_events.sql")),
    M::up(include_str!("migrations/004_tags_links.sql")),
    M::up(include_str!("migrations/005_quiz.sql")),
];

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).with_context(|| format!("建立資料夾 {}", dir.display()))?;
    }
    let mut conn = Connection::open(path).with_context(|| format!("開啟資料庫 {}", path.display()))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&mut conn)?;
    Ok(conn)
}

pub fn migrate(conn: &mut Connection) -> Result<()> {
    Migrations::new(MIGRATIONS.to_vec()).to_latest(conn).context("資料庫 migration")
}

/// 整批換掉上游資料。一個 transaction：失敗就保留舊資料。
pub fn replace_upstream(conn: &mut Connection, topics: &[TopicData], version: &str) -> Result<()> {
    let tx = conn.transaction()?;
    // cascade 會一路刪到 events
    tx.execute("DELETE FROM topics", [])?;
    tx.execute("DELETE FROM bundle_meta", [])?;

    for t in topics {
        tx.execute(
            "INSERT INTO topics (slug, name, title, description, column_label, jumps_json, default_ppy, order_no, root)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                t.slug,
                t.meta.name,
                t.meta.title,
                t.meta.description,
                t.meta.column_label,
                t.meta.jumps.as_ref().map(|j| serde_json::to_string(j).unwrap()),
                t.meta.default_ppy,
                t.meta.order,
                t.meta.root.unwrap_or(false) as i64,
            ],
        )?;
        tx.execute(
            "INSERT INTO timelines (topic, min_year, max_year) VALUES (?1, ?2, ?3)",
            params![t.slug, t.timeline.min_year, t.timeline.max_year],
        )?;
        for (i, c) in t.categories.iter().enumerate() {
            tx.execute(
                "INSERT INTO categories (topic, id, label, glyph, order_no) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![t.slug, c.id, c.label, c.glyph, i as i64],
            )?;
        }
        for r in &t.regions {
            tx.execute(
                "INSERT INTO regions (topic, id, name, subtitle, order_no) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![t.slug, r.meta.id, r.meta.name, r.meta.subtitle, r.meta.order],
            )?;
            for p in &r.periods {
                tx.execute(
                    "INSERT INTO periods (topic, region, id, name, track, start, end, note)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![t.slug, r.meta.id, p.id, p.name, p.track, p.start, p.end, p.note],
                )?;
            }
            for e in &r.events {
                tx.execute(
                    "INSERT INTO events (ref, topic, region, id, year, end_year, title, category, importance,
                                         desc, legendary, actual_year, sources_json, links_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    params![
                        format!("{}/{}/{}", t.slug, r.meta.id, e.id),
                        t.slug,
                        r.meta.id,
                        e.id,
                        e.year,
                        e.end_year,
                        e.title,
                        e.category,
                        e.importance,
                        e.desc,
                        e.legendary.map(|b| b as i64),
                        e.actual_year,
                        e.sources.as_ref().map(|s| serde_json::to_string(s).unwrap()),
                        e.links.as_ref().map(|l| serde_json::to_string(l).unwrap()),
                    ],
                )?;
            }
        }
    }
    tx.execute(
        "INSERT INTO bundle_meta (id, version, imported_at) VALUES (1, ?1, datetime('now'))",
        params![version],
    )?;

    // 內建 View 跟著上游走：每個主題一個，id 就是 slug。已不存在的主題連 View 一起刪。
    tx.execute("DELETE FROM views WHERE builtin = 1", [])?;
    for t in topics {
        tx.execute(
            "INSERT INTO views (id, name, min_year, max_year, default_ppy, order_no, builtin)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
            params![t.slug, t.meta.name, t.timeline.min_year, t.timeline.max_year, t.meta.default_ppy, t.meta.order],
        )?;
        for (i, r) in t.regions.iter().enumerate() {
            tx.execute(
                "INSERT INTO view_columns (view_id, order_no, topic, region) VALUES (?1, ?2, ?3, ?4)",
                params![t.slug, i as i64, t.slug, r.meta.id],
            )?;
        }
    }
    tx.commit()?;
    Ok(())
}

/* ---------------- View ---------------- */

pub fn views_all(conn: &Connection) -> Result<Vec<View>> {
    let mut st = conn.prepare(
        "SELECT id, name, min_year, max_year, default_ppy, order_no, builtin FROM views
         ORDER BY builtin DESC, order_no IS NULL, order_no, name",
    )?;
    let mut views: Vec<View> = st
        .query_map([], |r| {
            Ok(View {
                id: r.get(0)?,
                name: r.get(1)?,
                min_year: r.get(2)?,
                max_year: r.get(3)?,
                default_ppy: r.get(4)?,
                order: r.get(5)?,
                builtin: r.get::<_, i64>(6)? != 0,
                columns: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut cst = conn.prepare(
        "SELECT topic, region, importance_offset FROM view_columns WHERE view_id = ?1 ORDER BY order_no",
    )?;
    for v in &mut views {
        v.columns = cst
            .query_map([&v.id], |r| {
                Ok(ViewColumn { topic: r.get(0)?, region: r.get(1)?, importance_offset: r.get(2)? })
            })?
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(views)
}

pub fn view_get(conn: &Connection, id: &str) -> Result<Option<View>> {
    Ok(views_all(conn)?.into_iter().find(|v| v.id == id))
}

/// 新增或整個覆寫（欄位清單一併重寫）。內建的不給改。
pub fn view_save(conn: &mut Connection, v: &View) -> Result<()> {
    if let Some(existing) = view_get(conn, &v.id)? {
        if existing.builtin {
            bail!("內建的 View「{}」不能修改，請另存成新的組合。", existing.name);
        }
    }
    if v.columns.is_empty() {
        bail!("至少要有一個欄位。");
    }
    if v.max_year <= v.min_year {
        bail!("年份範圍的上限必須大於下限。");
    }
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO views (id, name, min_year, max_year, default_ppy, order_no, builtin)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, min_year = excluded.min_year,
           max_year = excluded.max_year, default_ppy = excluded.default_ppy,
           order_no = excluded.order_no, updated_at = datetime('now')",
        params![v.id, v.name, v.min_year, v.max_year, v.default_ppy, v.order],
    )?;
    tx.execute("DELETE FROM view_columns WHERE view_id = ?1", [&v.id])?;
    for (i, c) in v.columns.iter().enumerate() {
        let exists: bool = tx.query_row(
            "SELECT 1 FROM regions WHERE topic = ?1 AND id = ?2",
            params![c.topic, c.region],
            |_| Ok(true),
        ).optional()?.unwrap_or(false);
        if !exists {
            bail!("欄位 {}/{} 不存在。", c.topic, c.region);
        }
        tx.execute(
            "INSERT INTO view_columns (view_id, order_no, topic, region, importance_offset) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![v.id, i as i64, c.topic, c.region, c.importance_offset.clamp(-2, 2)],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn view_delete(conn: &Connection, id: &str) -> Result<()> {
    let n = conn.execute("DELETE FROM views WHERE id = ?1 AND builtin = 0", [id])?;
    if n == 0 {
        bail!("找不到可刪除的 View「{id}」（內建的不能刪）。");
    }
    Ok(())
}

/* ---------------- 讀取 ---------------- */

fn topic_meta_from_row(row: &rusqlite::Row) -> rusqlite::Result<(String, TopicMeta)> {
    let jumps: Option<String> = row.get("jumps_json")?;
    Ok((
        row.get("slug")?,
        TopicMeta {
            name: row.get("name")?,
            title: row.get("title")?,
            description: row.get("description")?,
            column_label: row.get("column_label")?,
            jumps: jumps.map(|j| serde_json::from_str(&j).unwrap_or_default()),
            default_ppy: row.get("default_ppy")?,
            order: row.get("order_no")?,
            root: Some(row.get::<_, i64>("root")? != 0).filter(|b| *b),
        },
    ))
}

pub fn all_topics(conn: &Connection) -> Result<Vec<(String, TopicMeta)>> {
    let mut st = conn.prepare("SELECT * FROM topics")?;
    let rows = st.query_map([], topic_meta_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn root_topic(conn: &Connection) -> Result<String> {
    conn.query_row("SELECT slug FROM topics WHERE root = 1 LIMIT 1", [], |r| r.get(0))
        .optional()?
        .ok_or_else(|| anyhow!("資料庫裡沒有 root 主題，請先載入資料。"))
}

pub fn timeline_of(conn: &Connection, topic: &str) -> Result<Option<Timeline>> {
    Ok(conn
        .query_row(
            "SELECT min_year, max_year FROM timelines WHERE topic = ?1",
            [topic],
            |r| Ok(Timeline { min_year: r.get(0)?, max_year: r.get(1)? }),
        )
        .optional()?)
}

pub fn categories_of(conn: &Connection, topic: &str) -> Result<Vec<CategoryDef>> {
    let mut st = conn.prepare("SELECT id, label, glyph FROM categories WHERE topic = ?1 ORDER BY order_no")?;
    let rows = st.query_map([topic], |r| Ok(CategoryDef { id: r.get(0)?, label: r.get(1)?, glyph: r.get(2)? }))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn regions_of(conn: &Connection, topic: &str) -> Result<Vec<RegionMeta>> {
    let mut st = conn.prepare("SELECT id, name, subtitle, order_no FROM regions WHERE topic = ?1 ORDER BY order_no")?;
    let rows = st.query_map([topic], |r| {
        Ok(RegionMeta { id: r.get(0)?, name: r.get(1)?, subtitle: r.get(2)?, order: r.get(3)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn periods_of(conn: &Connection, topic: &str, region: &str) -> Result<Vec<Period>> {
    let mut st = conn.prepare(
        "SELECT id, name, track, start, end, note FROM periods WHERE topic = ?1 AND region = ?2 ORDER BY start",
    )?;
    let rows = st.query_map([topic, region], |r| {
        Ok(Period {
            id: r.get(0)?,
            name: r.get(1)?,
            track: r.get(2)?,
            start: r.get(3)?,
            end: r.get(4)?,
            note: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn events_of(conn: &Connection, topic: &str, region: &str) -> Result<Vec<Event>> {
    let mut st = conn.prepare(
        "SELECT id, year, end_year, title, category, importance, desc, legendary, actual_year, sources_json, links_json
         FROM events WHERE topic = ?1 AND region = ?2 ORDER BY year",
    )?;
    let rows = st.query_map([topic, region], |r| {
        let sources: Option<String> = r.get(9)?;
        let links: Option<String> = r.get(10)?;
        Ok(Event {
            id: r.get(0)?,
            year: r.get(1)?,
            end_year: r.get(2)?,
            title: r.get(3)?,
            category: r.get(4)?,
            importance: r.get(5)?,
            desc: r.get(6)?,
            legendary: r.get::<_, Option<i64>>(7)?.map(|b| b != 0),
            actual_year: r.get(8)?,
            sources: sources.and_then(|s| serde_json::from_str(&s).ok()),
            links: links.and_then(|s| serde_json::from_str(&s).ok()),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/* ---------------- 使用者事件 ---------------- */

fn user_event_from_row(r: &rusqlite::Row) -> rusqlite::Result<UserEvent> {
    let sources: Option<String> = r.get("sources_json")?;
    Ok(UserEvent {
        r#ref: r.get("ref")?,
        year: r.get("year")?,
        end_year: r.get("end_year")?,
        title: r.get("title")?,
        desc: r.get("desc")?,
        importance: r.get("importance")?,
        legendary: r.get::<_, i64>("legendary")? != 0,
        sources: sources.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
        placements: Vec::new(),
    })
}

fn fill_placements(conn: &Connection, events: &mut [UserEvent]) -> Result<()> {
    let mut st = conn.prepare(
        "SELECT topic, region, category FROM event_placements WHERE event_ref = ?1 ORDER BY rowid",
    )?;
    for e in events {
        e.placements = st
            .query_map([&e.r#ref], |r| Ok(Placement { topic: r.get(0)?, region: r.get(1)?, category: r.get(2)? }))?
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(())
}

pub fn user_events_all(conn: &Connection) -> Result<Vec<UserEvent>> {
    let mut st = conn.prepare("SELECT * FROM user_events ORDER BY year, title")?;
    let mut out: Vec<UserEvent> = st.query_map([], user_event_from_row)?.collect::<rusqlite::Result<_>>()?;
    fill_placements(conn, &mut out)?;
    Ok(out)
}

pub fn user_event_get(conn: &Connection, r#ref: &str) -> Result<Option<UserEvent>> {
    let mut st = conn.prepare("SELECT * FROM user_events WHERE ref = ?1")?;
    let mut out: Vec<UserEvent> = st.query_map([r#ref], user_event_from_row)?.collect::<rusqlite::Result<_>>()?;
    fill_placements(conn, &mut out)?;
    Ok(out.pop())
}

/// 放在某一欄上的使用者事件，已轉成畫圖用的 Event（id = ref，category = placement 的）。
pub fn user_events_in_column(conn: &Connection, topic: &str, region: &str) -> Result<Vec<Event>> {
    let mut st = conn.prepare(
        "SELECT e.ref, e.year, e.end_year, e.title, p.category, e.importance, e.desc, e.legendary, e.sources_json
         FROM event_placements p JOIN user_events e ON e.ref = p.event_ref
         WHERE p.topic = ?1 AND p.region = ?2 ORDER BY e.year",
    )?;
    let rows = st.query_map([topic, region], |r| {
        let sources: Option<String> = r.get(8)?;
        Ok(Event {
            id: r.get(0)?,
            year: r.get(1)?,
            end_year: r.get(2)?,
            title: r.get(3)?,
            category: r.get(4)?,
            importance: r.get(5)?,
            desc: r.get(6)?,
            legendary: Some(r.get::<_, i64>(7)? != 0).filter(|b| *b),
            actual_year: None,
            sources: sources.and_then(|s| serde_json::from_str::<Vec<Source>>(&s).ok()).filter(|v| !v.is_empty()),
            links: None,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// 新增或整個覆寫。驗證跟上游資料同一套標準：沒有西元 0 年、importance 1…5、
/// endYear ≥ year、每個 placement 的欄位存在、類別屬於該主題、年份落在該主題的軸上
/// （落在外面會被靜默畫到畫布外，正是網站最忌諱的 bug）。
pub fn user_event_save(conn: &mut Connection, e: &UserEvent) -> Result<()> {
    if !e.r#ref.starts_with("user/") {
        bail!("使用者事件的 ref 必須以 user/ 開頭");
    }
    if e.title.trim().is_empty() {
        bail!("標題不能是空的");
    }
    if e.year == 0 || e.end_year == Some(0) {
        bail!("沒有西元 0 年（-1 的下一年是 1）");
    }
    if !(1..=5).contains(&e.importance) {
        bail!("importance 要在 1…5");
    }
    if let Some(ey) = e.end_year {
        if ey < e.year {
            bail!("endYear 不能早於 year");
        }
    }
    if e.placements.is_empty() {
        bail!("至少要放到一個欄位上");
    }
    let to = e.end_year.unwrap_or(e.year);
    for p in &e.placements {
        let region_ok: bool = conn
            .query_row("SELECT 1 FROM regions WHERE topic = ?1 AND id = ?2", params![p.topic, p.region], |_| Ok(true))
            .optional()?
            .unwrap_or(false);
        if !region_ok {
            bail!("欄位 {}/{} 不存在", p.topic, p.region);
        }
        let cat_ok: bool = conn
            .query_row("SELECT 1 FROM categories WHERE topic = ?1 AND id = ?2", params![p.topic, p.category], |_| Ok(true))
            .optional()?
            .unwrap_or(false);
        if !cat_ok {
            let avail: Vec<String> = categories_of(conn, &p.topic)?.into_iter().map(|c| c.id).collect();
            bail!("類別 \"{}\" 不在主題 \"{}\" 的類別表裡（可用：{}）", p.category, p.topic, avail.join("、"));
        }
        let t = timeline_of(conn, &p.topic)?.ok_or_else(|| anyhow!("{} 缺 timeline", p.topic))?;
        if e.year < t.min_year || to > t.max_year {
            bail!(
                "年份 {}…{to} 超出主題 \"{}\" 的時間軸範圍 {}…{}，放上去會被畫到畫布外",
                e.year, p.topic, t.min_year, t.max_year
            );
        }
    }

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO user_events (ref, year, end_year, title, desc, importance, legendary, sources_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(ref) DO UPDATE SET year = excluded.year, end_year = excluded.end_year,
           title = excluded.title, desc = excluded.desc, importance = excluded.importance,
           legendary = excluded.legendary, sources_json = excluded.sources_json,
           updated_at = datetime('now')",
        params![
            e.r#ref,
            e.year,
            e.end_year,
            e.title.trim(),
            e.desc.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            e.importance,
            e.legendary as i64,
            if e.sources.is_empty() { None } else { Some(serde_json::to_string(&e.sources)?) },
        ],
    )?;
    tx.execute("DELETE FROM event_placements WHERE event_ref = ?1", [&e.r#ref])?;
    for p in &e.placements {
        tx.execute(
            "INSERT OR REPLACE INTO event_placements (event_ref, topic, region, category) VALUES (?1, ?2, ?3, ?4)",
            params![e.r#ref, p.topic, p.region, p.category],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn user_event_delete(conn: &Connection, r#ref: &str) -> Result<()> {
    let n = conn.execute("DELETE FROM user_events WHERE ref = ?1", [r#ref])?;
    if n == 0 {
        bail!("找不到事件 {ref}");
    }
    Ok(())
}

/* ---------------- Tag ---------------- */

pub fn tags_all(conn: &Connection) -> Result<Vec<Tag>> {
    let mut st = conn.prepare(
        "SELECT t.id, t.parent_id, t.name, t.color, t.order_no,
                (SELECT COUNT(*) FROM event_tags e WHERE e.tag_id = t.id)
         FROM tags t ORDER BY t.order_no, t.name",
    )?;
    let rows = st.query_map([], |r| {
        Ok(Tag {
            id: r.get(0)?,
            parent_id: r.get(1)?,
            name: r.get(2)?,
            color: r.get(3)?,
            order: r.get(4)?,
            count: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn tag_save(conn: &Connection, t: &Tag) -> Result<()> {
    if t.name.trim().is_empty() {
        bail!("Tag 名稱不能是空的");
    }
    // 父子不能成環：沿 parent 往上走不可以回到自己
    let mut cur = t.parent_id.clone();
    let mut hops = 0;
    while let Some(p) = cur {
        if p == t.id {
            bail!("Tag 的父層不能是自己或自己的子層");
        }
        cur = conn.query_row("SELECT parent_id FROM tags WHERE id = ?1", [&p], |r| r.get(0)).optional()?.flatten();
        hops += 1;
        if hops > 32 {
            bail!("Tag 層級太深");
        }
    }
    conn.execute(
        "INSERT INTO tags (id, parent_id, name, color, order_no) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id,
           name = excluded.name, color = excluded.color, order_no = excluded.order_no",
        params![t.id, t.parent_id, t.name.trim(), t.color, t.order],
    )?;
    Ok(())
}

/// 刪 tag：事件上的標記一起刪（CASCADE），子 tag 升到上一層（SET NULL）
pub fn tag_delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM tags WHERE id = ?1", [id])?;
    Ok(())
}

pub fn event_tag_ids(conn: &Connection, r#ref: &str) -> Result<Vec<String>> {
    let mut st = conn.prepare("SELECT tag_id FROM event_tags WHERE event_ref = ?1")?;
    let rows = st.query_map([r#ref], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn event_tags_set(conn: &mut Connection, r#ref: &str, tag_ids: &[String], title: &str) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM event_tags WHERE event_ref = ?1", [r#ref])?;
    for t in tag_ids {
        tx.execute(
            "INSERT OR IGNORE INTO event_tags (event_ref, tag_id, title_snapshot) VALUES (?1, ?2, ?3)",
            params![r#ref, t, title],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// 打了某個 tag 的事件（含子 tag 的）。回傳 ref + 標題快照；標題以現在的資料為準，
/// 找不到（孤兒）才退回快照。
pub fn events_with_tag(conn: &Connection, tag_id: &str) -> Result<Vec<EventHit>> {
    // 子孫 tag
    let mut ids = vec![tag_id.to_string()];
    let mut i = 0;
    while i < ids.len() {
        let mut st = conn.prepare("SELECT id FROM tags WHERE parent_id = ?1")?;
        let kids: Vec<String> = st.query_map([&ids[i]], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        for k in kids {
            if !ids.contains(&k) {
                ids.push(k);
            }
        }
        i += 1;
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for t in &ids {
        let mut st = conn.prepare("SELECT event_ref, title_snapshot FROM event_tags WHERE tag_id = ?1")?;
        let rows: Vec<(String, String)> =
            st.query_map([t], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
        for (r#ref, snap) in rows {
            if seen.insert(r#ref.clone()) {
                out.push(resolve_hit(conn, &r#ref, &snap)?);
            }
        }
    }
    out.sort_by_key(|h| h.year);
    Ok(out)
}

/// 用 ref 查現在的事件；找不到就用快照並標記 orphan
pub fn resolve_hit(conn: &Connection, r#ref: &str, snapshot: &str) -> Result<EventHit> {
    if let Some(u) = user_event_get(conn, r#ref)? {
        let p = u.placements.first();
        return Ok(EventHit {
            r#ref: r#ref.to_string(),
            title: u.title,
            year: u.year,
            topic: p.map(|p| p.topic.clone()).unwrap_or_default(),
            region: p.map(|p| p.region.clone()).unwrap_or_default(),
            topic_name: p.map(|p| topic_name_of(conn, &p.topic)).unwrap_or_default(),
            region_name: p.map(|p| region_name_of(conn, &p.topic, &p.region)).unwrap_or_default(),
            event_id: r#ref.to_string(),
            orphan: false,
        });
    }
    let row: Option<(String, String, String, i64, String)> = conn
        .query_row(
            "SELECT topic, region, id, year, title FROM events WHERE ref = ?1",
            [r#ref],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    Ok(match row {
        Some((topic, region, id, year, title)) => EventHit {
            r#ref: r#ref.to_string(),
            title,
            year,
            topic_name: topic_name_of(conn, &topic),
            region_name: region_name_of(conn, &topic, &region),
            topic,
            region,
            event_id: id,
            orphan: false,
        },
        None => EventHit {
            r#ref: r#ref.to_string(),
            title: snapshot.to_string(),
            year: 0,
            topic: String::new(),
            region: String::new(),
            topic_name: String::new(),
            region_name: String::new(),
            event_id: String::new(),
            orphan: true,
        },
    })
}

fn topic_name_of(conn: &Connection, slug: &str) -> String {
    conn.query_row("SELECT name FROM topics WHERE slug = ?1", [slug], |r| r.get(0)).unwrap_or_else(|_| slug.to_string())
}
fn region_name_of(conn: &Connection, topic: &str, region: &str) -> String {
    conn.query_row("SELECT name FROM regions WHERE topic = ?1 AND id = ?2", [topic, region], |r| r.get(0))
        .unwrap_or_else(|_| region.to_string())
}

/// 全域搜尋（上游 + 使用者事件），給關聯目標選擇器用。子字串比對標題，跟網站 search.ts 一樣不斷詞。
pub fn search_events(conn: &Connection, q: &str, limit: usize) -> Result<Vec<EventHit>> {
    let q = q.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
    let mut out = Vec::new();
    let mut st = conn.prepare(
        "SELECT ref FROM events WHERE title LIKE ?1 ESCAPE '\\' ORDER BY importance DESC, year LIMIT ?2",
    )?;
    let refs: Vec<String> = st.query_map(params![like, limit as i64], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for r in refs {
        out.push(resolve_hit(conn, &r, "")?);
    }
    let mut st = conn.prepare("SELECT ref FROM user_events WHERE title LIKE ?1 ESCAPE '\\' ORDER BY year LIMIT ?2")?;
    let refs: Vec<String> = st.query_map(params![like, limit as i64], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for r in refs {
        out.push(resolve_hit(conn, &r, "")?);
    }
    Ok(out)
}

/* ---------------- 有向關聯 ---------------- */

pub fn links_of(conn: &Connection, r#ref: &str) -> Result<Vec<EventLink>> {
    let mut st = conn.prepare(
        "SELECT id, from_ref, to_ref, kind, note, snapshot_from, snapshot_to FROM event_links
         WHERE from_ref = ?1 OR to_ref = ?1 ORDER BY created_at",
    )?;
    let rows: Vec<(String, String, String, String, Option<String>, String, String)> = st
        .query_map([r#ref], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut out = Vec::new();
    for (id, from, to, kind, note, sf, st_) in rows {
        out.push(EventLink {
            id,
            from: resolve_hit(conn, &from, &sf)?,
            to: resolve_hit(conn, &to, &st_)?,
            kind,
            note,
        });
    }
    Ok(out)
}

pub fn link_save(conn: &Connection, l: &LinkInput) -> Result<()> {
    if l.from_ref == l.to_ref {
        bail!("事件不能關聯到自己");
    }
    if l.kind.trim().is_empty() {
        bail!("關係類型不能是空的");
    }
    let from = resolve_hit(conn, &l.from_ref, "")?;
    let to = resolve_hit(conn, &l.to_ref, "")?;
    if from.orphan || to.orphan {
        bail!("關聯的兩端都必須是存在的事件");
    }
    conn.execute(
        "INSERT INTO event_links (id, from_ref, to_ref, kind, note, snapshot_from, snapshot_to)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET from_ref = excluded.from_ref, to_ref = excluded.to_ref,
           kind = excluded.kind, note = excluded.note, snapshot_from = excluded.snapshot_from,
           snapshot_to = excluded.snapshot_to",
        params![l.id, l.from_ref, l.to_ref, l.kind.trim(), l.note.as_deref().map(str::trim).filter(|s| !s.is_empty()), from.title, to.title],
    )?;
    Ok(())
}

pub fn link_delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM event_links WHERE id = ?1", [id])?;
    Ok(())
}

/* ---------------- 題庫 ---------------- */

fn question_from_row(r: &rusqlite::Row) -> rusqlite::Result<Question> {
    let options: String = r.get("options_json")?;
    let answer: String = r.get("answer_json")?;
    Ok(Question {
        id: r.get("id")?,
        kind: r.get("kind")?,
        prompt: r.get("prompt")?,
        options: serde_json::from_str(&options).unwrap_or_default(),
        answer: serde_json::from_str(&answer).unwrap_or(serde_json::Value::Null),
        explanation: r.get("explanation")?,
        source_file: r.get("source_file")?,
        events: Vec::new(),
    })
}

fn review_of(conn: &Connection, id: &str) -> Result<ReviewState> {
    Ok(conn
        .query_row(
            "SELECT ease, interval_days, due_at, reps, lapses, last_grade FROM review_state WHERE question_id = ?1",
            [id],
            |r| {
                Ok(ReviewState {
                    ease: r.get(0)?,
                    interval_days: r.get(1)?,
                    due_at: r.get(2)?,
                    reps: r.get(3)?,
                    lapses: r.get(4)?,
                    last_grade: r.get(5)?,
                })
            },
        )
        .optional()?
        .unwrap_or_default())
}

fn card_of(conn: &Connection, mut q: Question) -> Result<QuestionCard> {
    let mut st = conn.prepare("SELECT event_ref, title_snapshot FROM question_events WHERE question_id = ?1")?;
    let rows: Vec<(String, String)> = st.query_map([&q.id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut hits = Vec::new();
    for (r#ref, snap) in rows {
        let h = resolve_hit(conn, &r#ref, &snap)?;
        q.events.push(QuestionEventRef { r#ref: h.r#ref.clone(), title: h.title.clone() });
        hits.push(h);
    }
    let review = review_of(conn, &q.id)?;
    let due = match &review.due_at {
        None => true,
        Some(d) => d.as_str() <= now_str().as_str(),
    };
    Ok(QuestionCard { question: q, review, hits, due })
}

fn now_str() -> String {
    // 跟 SQLite 的 datetime('now') 同格式（UTC）
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    fmt_utc(secs)
}

fn fmt_utc(secs: i64) -> String {
    // 簡單的 civil-from-days（Howard Hinnant），避免拉 chrono
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}", rem / 3600, (rem % 3600) / 60, rem % 60)
}

pub fn questions_all(conn: &Connection) -> Result<Vec<QuestionCard>> {
    let mut st = conn.prepare("SELECT * FROM questions ORDER BY created_at DESC")?;
    let qs: Vec<Question> = st.query_map([], question_from_row)?.collect::<rusqlite::Result<_>>()?;
    qs.into_iter().map(|q| card_of(conn, q)).collect()
}

pub fn question_get(conn: &Connection, id: &str) -> Result<Option<QuestionCard>> {
    let mut st = conn.prepare("SELECT * FROM questions WHERE id = ?1")?;
    let q: Option<Question> = st.query_map([id], question_from_row)?.next().transpose()?;
    q.map(|q| card_of(conn, q)).transpose()
}

/// 掛在某一則事件上的題目
pub fn questions_for_event(conn: &Connection, r#ref: &str) -> Result<Vec<QuestionCard>> {
    let mut st = conn.prepare(
        "SELECT q.* FROM questions q JOIN question_events e ON e.question_id = q.id WHERE e.event_ref = ?1 ORDER BY q.created_at",
    )?;
    let qs: Vec<Question> = st.query_map([r#ref], question_from_row)?.collect::<rusqlite::Result<_>>()?;
    qs.into_iter().map(|q| card_of(conn, q)).collect()
}

pub fn question_save(conn: &mut Connection, q: &Question) -> Result<()> {
    crate::quiz::validate_question(q)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO questions (id, kind, prompt, options_json, answer_json, explanation, source_file)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, prompt = excluded.prompt,
           options_json = excluded.options_json, answer_json = excluded.answer_json,
           explanation = excluded.explanation, updated_at = datetime('now')",
        params![
            q.id,
            q.kind,
            q.prompt.trim(),
            serde_json::to_string(&q.options)?,
            serde_json::to_string(&q.answer)?,
            q.explanation.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            q.source_file,
        ],
    )?;
    tx.execute("DELETE FROM question_events WHERE question_id = ?1", [&q.id])?;
    for e in &q.events {
        // 快照以現況為準；匯入的 CSV 只有 ref 沒標題，就在這裡補
        let h = resolve_hit(&tx, &e.r#ref, &e.title)?;
        tx.execute(
            "INSERT OR IGNORE INTO question_events (question_id, event_ref, title_snapshot) VALUES (?1, ?2, ?3)",
            params![q.id, e.r#ref, h.title],
        )?;
    }
    tx.execute("INSERT OR IGNORE INTO review_state (question_id) VALUES (?1)", [&q.id])?;
    tx.commit()?;
    Ok(())
}

pub fn question_delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM questions WHERE id = ?1", [id])?;
    Ok(())
}

/// 到期的題目（含從沒複習過的），依到期時間排；錯題本 = lapses > 0
pub fn questions_queue(conn: &Connection, wrong_only: bool, limit: usize) -> Result<Vec<QuestionCard>> {
    let all = questions_all(conn)?;
    let mut list: Vec<QuestionCard> = all
        .into_iter()
        .filter(|c| if wrong_only { c.review.lapses > 0 } else { c.due })
        .collect();
    list.sort_by(|a, b| a.review.due_at.cmp(&b.review.due_at));
    list.truncate(limit);
    Ok(list)
}

pub fn grade_question(conn: &mut Connection, id: &str, grade: i64, elapsed_ms: Option<i64>) -> Result<ReviewState> {
    let cur = review_of(conn, id)?;
    let next = crate::quiz::sm2(&cur, grade);
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let due_at = fmt_utc(secs + next.interval_days * 86400);
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO review_state (question_id, ease, interval_days, due_at, reps, lapses, last_grade)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(question_id) DO UPDATE SET ease = excluded.ease, interval_days = excluded.interval_days,
           due_at = excluded.due_at, reps = excluded.reps, lapses = excluded.lapses, last_grade = excluded.last_grade",
        params![id, next.ease, next.interval_days, due_at, next.reps, next.lapses, next.last_grade],
    )?;
    tx.execute(
        "INSERT INTO review_log (question_id, grade, elapsed_ms) VALUES (?1, ?2, ?3)",
        params![id, grade.clamp(0, 5), elapsed_ms],
    )?;
    tx.commit()?;
    Ok(ReviewState { due_at: Some(due_at), ..next })
}

pub fn quiz_stats(conn: &Connection) -> Result<QuizStats> {
    let all = questions_all(conn)?;
    let today = now_str()[..10].to_string();
    let reviewed_today: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT question_id) FROM review_log WHERE substr(reviewed_at, 1, 10) = ?1",
        [today],
        |r| r.get(0),
    )?;
    Ok(QuizStats {
        total: all.len() as i64,
        due: all.iter().filter(|c| c.due).count() as i64,
        wrong: all.iter().filter(|c| c.review.lapses > 0).count() as i64,
        reviewed_today,
    })
}

/* ---------------- 同步與孤兒 ---------------- */

pub fn bundle_info(conn: &Connection, from_repo: bool) -> Result<BundleInfo> {
    let (version, imported_at): (String, String) = conn
        .query_row("SELECT version, imported_at FROM bundle_meta WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .unwrap_or_else(|| ("（尚未載入）".into(), String::new()));
    let event_count: u64 = conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get::<_, i64>(0))? as u64;
    let topic_count: u64 = conn.query_row("SELECT COUNT(*) FROM topics", [], |r| r.get::<_, i64>(0))? as u64;
    Ok(BundleInfo { version, imported_at, event_count, topic_count, from_repo })
}

pub fn has_upstream(conn: &Connection) -> Result<bool> {
    Ok(conn.query_row("SELECT COUNT(*) FROM topics", [], |r| r.get::<_, i64>(0))? > 0)
}

/// 使用者資料裡指向已不存在事件的列。**只列出、不刪**——刪是使用者的決定。
pub fn orphans(conn: &Connection) -> Result<Vec<Orphan>> {
    let exists = |r#ref: &str| -> Result<bool> {
        if r#ref.starts_with("user/") {
            return Ok(user_event_get(conn, r#ref)?.is_some());
        }
        Ok(conn.query_row("SELECT 1 FROM events WHERE ref = ?1", [r#ref], |_| Ok(())).optional()?.is_some())
    };
    let mut out = Vec::new();

    let mut st = conn.prepare("SELECT event_ref, tag_id, title_snapshot, (SELECT name FROM tags WHERE id = tag_id) FROM event_tags")?;
    let rows: Vec<(String, String, String, Option<String>)> =
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<rusqlite::Result<_>>()?;
    for (r#ref, tag, snap, name) in rows {
        if !exists(&r#ref)? {
            out.push(Orphan { kind: "event_tag".into(), key: format!("{ref}\u{1f}{tag}"), r#ref, snapshot: snap, detail: format!("tag「{}」", name.unwrap_or(tag)) });
        }
    }

    let mut st = conn.prepare("SELECT id, from_ref, to_ref, kind, snapshot_from, snapshot_to FROM event_links")?;
    let rows: Vec<(String, String, String, String, String, String)> = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (id, from, to, kind, sf, st_) in rows {
        let (fo, to_) = (!exists(&from)?, !exists(&to)?);
        if fo || to_ {
            out.push(Orphan {
                kind: "event_link".into(),
                key: id,
                r#ref: if fo { from } else { to },
                snapshot: if fo { sf.clone() } else { st_.clone() },
                detail: format!("關聯「{sf}」{kind}→「{st_}」"),
            });
        }
    }

    let mut st = conn.prepare("SELECT question_id, event_ref, title_snapshot, (SELECT prompt FROM questions WHERE id = question_id) FROM question_events")?;
    let rows: Vec<(String, String, String, Option<String>)> =
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<rusqlite::Result<_>>()?;
    for (qid, r#ref, snap, prompt) in rows {
        if !exists(&r#ref)? {
            out.push(Orphan { kind: "question_event".into(), key: format!("{qid}\u{1f}{ref}"), r#ref, snapshot: snap, detail: format!("題目「{}」", prompt.unwrap_or_default()) });
        }
    }

    // placement 指向的欄位或類別不見了（上游改了 regions.yaml／categories.yaml）
    let mut st = conn.prepare(
        "SELECT p.event_ref, p.topic, p.region, p.category, e.title FROM event_placements p JOIN user_events e ON e.ref = p.event_ref",
    )?;
    let rows: Vec<(String, String, String, String, String)> =
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<rusqlite::Result<_>>()?;
    for (r#ref, topic, region, category, title) in rows {
        let region_ok = conn.query_row("SELECT 1 FROM regions WHERE topic = ?1 AND id = ?2", params![topic, region], |_| Ok(())).optional()?.is_some();
        let cat_ok = conn.query_row("SELECT 1 FROM categories WHERE topic = ?1 AND id = ?2", params![topic, category], |_| Ok(())).optional()?.is_some();
        if !region_ok || !cat_ok {
            out.push(Orphan {
                kind: "placement".into(),
                key: format!("{ref}\u{1f}{topic}\u{1f}{region}"),
                r#ref: r#ref.clone(),
                snapshot: title,
                detail: if !region_ok { format!("欄位 {topic}/{region} 已不存在") } else { format!("類別 {topic}/{category} 已不存在") },
            });
        }
    }
    Ok(out)
}

pub fn orphan_delete(conn: &Connection, kind: &str, key: &str) -> Result<()> {
    let parts: Vec<&str> = key.split('\u{1f}').collect();
    let n = match (kind, parts.as_slice()) {
        ("event_tag", [r#ref, tag]) => conn.execute("DELETE FROM event_tags WHERE event_ref = ?1 AND tag_id = ?2", params![r#ref, tag])?,
        ("event_link", [id]) => conn.execute("DELETE FROM event_links WHERE id = ?1", [id])?,
        ("question_event", [qid, r#ref]) => conn.execute("DELETE FROM question_events WHERE question_id = ?1 AND event_ref = ?2", params![qid, r#ref])?,
        ("placement", [r#ref, topic, region]) => {
            conn.execute("DELETE FROM event_placements WHERE event_ref = ?1 AND topic = ?2 AND region = ?3", params![r#ref, topic, region])?
        }
        _ => bail!("未知的孤兒類型 {kind}"),
    };
    if n == 0 {
        bail!("找不到要刪的列");
    }
    Ok(())
}

