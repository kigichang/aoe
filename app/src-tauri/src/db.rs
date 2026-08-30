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
