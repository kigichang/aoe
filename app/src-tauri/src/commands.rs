//! 前端 `invoke()` 的入口，與 app/src/api.ts 一對一。錯誤一律轉成 String 給前端顯示。

use crate::db;
use crate::model::*;
use crate::AppState;
use anyhow::{anyhow, Result};
use tauri::State;

fn build_view_payload(conn: &rusqlite::Connection, view: Option<&str>) -> Result<ViewPayload> {
    // Phase 0：View id 就是主題 slug；沒給就是 root 主題。
    // Phase 2 之後這裡改查 views 表，跨主題合併也在這裡做。
    let all = db::all_topics(conn)?;
    let view_id = match view {
        Some(v) if !v.is_empty() => v.to_string(),
        _ => db::root_topic(conn)?,
    };
    let (_, topic) = all
        .iter()
        .find(|(slug, _)| *slug == view_id)
        .cloned()
        .ok_or_else(|| {
            anyhow!(
                "找不到主題 \"{view_id}\"。可用的主題：{}",
                all.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>().join("、")
            )
        })?;
    let timeline = db::timeline_of(conn, &view_id)?.ok_or_else(|| anyhow!("主題 \"{view_id}\" 缺少 timeline"))?;
    let categories = db::categories_of(conn, &view_id)?;

    let mut regions = Vec::new();
    for meta in db::regions_of(conn, &view_id)? {
        let periods = db::periods_of(conn, &view_id, &meta.id)?;
        let events = db::events_of(conn, &view_id, &meta.id)?;
        regions.push(RegionPayload { meta, periods, events });
    }

    let mut topics: Vec<TopicEntry> = all
        .iter()
        .map(|(slug, meta)| {
            Ok(TopicEntry {
                slug: slug.clone(),
                meta: meta.clone(),
                href: format!("?view={slug}"),
                is_current: *slug == view_id,
                timeline: db::timeline_of(conn, slug)?,
            })
        })
        .collect::<Result<_>>()?;
    // 同 data.ts：order 沒填的排後面，同組依 slug
    topics.sort_by(|a, b| {
        let oa = a.meta.order.unwrap_or(f64::INFINITY);
        let ob = b.meta.order.unwrap_or(f64::INFINITY);
        oa.partial_cmp(&ob).unwrap().then_with(|| a.slug.cmp(&b.slug))
    });

    Ok(ViewPayload { view_id, topic, timeline, categories, regions, topics })
}

#[tauri::command]
pub fn get_view_payload(view: Option<String>, state: State<'_, AppState>) -> Result<ViewPayload, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    build_view_payload(&conn, view.as_deref()).map_err(|e| format!("{e:#}"))
}

/// 開發期：從 repo 的 YAML 重新載入上游資料
#[tauri::command]
pub fn reload_from_repo(state: State<'_, AppState>) -> Result<usize, String> {
    let dir = state.topics_dir.clone().ok_or("沒有設定資料來源（AOE_TOPICS_DIR）")?;
    let topics = crate::loader::load_topics(&dir).map_err(|e| format!("{e:#}"))?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::replace_upstream(&mut conn, &topics, "repo").map_err(|e| format!("{e:#}"))?;
    Ok(topics.iter().map(|t| t.regions.iter().map(|r| r.events.len()).sum::<usize>()).sum())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_for_world_matches_web_shape() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src/topics");
        let topics = crate::loader::load_topics(&dir).expect("load repo YAML");
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        rusqlite_migration::Migrations::new(vec![rusqlite_migration::M::up(include_str!("schema.sql"))])
            .to_latest(&mut conn)
            .unwrap();
        db::replace_upstream(&mut conn, &topics, "test").unwrap();

        let p = build_view_payload(&conn, Some("world")).unwrap();
        assert_eq!(p.view_id, "world");
        assert_eq!(p.timeline.min_year, -3000);
        assert_eq!(p.regions.len(), 4);
        assert_eq!(p.categories.len(), 6);
        assert_eq!(p.topics.len(), 8);
        assert!(p.topics.iter().any(|t| t.is_current && t.slug == "world"));

        // 沒給 view → root 主題
        let root = build_view_payload(&conn, None).unwrap();
        assert_eq!(root.view_id, "taiwan");

        // JSON 欄位名要是 camelCase，跟 schema.ts 一致
        let json = serde_json::to_value(&p).unwrap();
        let ev = &json["regions"][2]["events"][0];
        assert!(ev.get("year").is_some() && ev.get("importance").is_some());
        assert!(json["timeline"].get("minYear").is_some());
        assert!(json["topic"].get("columnLabel").is_some());
        let with_end = json["regions"].as_array().unwrap().iter()
            .flat_map(|r| r["events"].as_array().unwrap())
            .find(|e| e.get("endYear").is_some());
        assert!(with_end.is_some(), "endYear should serialize as camelCase");
    }
}
