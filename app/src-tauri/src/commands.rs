//! 前端 `invoke()` 的入口，與 app/src/api.ts 一對一。錯誤一律轉成 String 給前端顯示。

use crate::db;
use crate::model::*;
use crate::AppState;
use anyhow::{anyhow, Result};
use std::collections::BTreeSet;
use tauri::State;

/// 一個 View 組成一份「看起來像單一主題」的 payload。跨主題的合併全在這裡：
///
/// - **類別**：欄位來自多個主題時，類別 id 加主題前綴（`science:discovery`），
///   事件的 `category` 一併改寫；glyph 仍是它自己主題的。label 後面帶主題名，
///   否則工具列上會有三個都叫「政治」的 chip。
/// - **事件 id / 欄位 id**：同樣加前綴。事件 id 只在單一 region 檔內唯一，
///   taiwan 與 world 更是刻意共用 `tw-*`；前端的 `ALL_EVENTS.find(id)` 需要全域唯一。
/// - **範圍**：View 有自己的上下界。落在外面的事件不進 payload，但欄位副標會寫
///   「另有 N 則不在此範圍」—— 不讓 `assertInRange` 炸、也不靜默消失。
///   跨過邊界的時期夾到邊界（跟 taiwan 主題的做法一樣）。
/// - **importance**：各主題尺規不同，每欄可加 `importance_offset` 再夾在 1…5。
fn build_view_payload(conn: &rusqlite::Connection, view: Option<&str>) -> Result<ViewPayload> {
    let all = db::all_topics(conn)?;
    let view_id = match view {
        Some(v) if !v.is_empty() => v.to_string(),
        _ => db::root_topic(conn)?,
    };
    let view = db::view_get(conn, &view_id)?.ok_or_else(|| {
        anyhow!(
            "找不到 View \"{view_id}\"。可用的主題：{}",
            all.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>().join("、")
        )
    })?;

    let timeline = Timeline { min_year: view.min_year, max_year: view.max_year };
    let distinct_topics: BTreeSet<&str> = view.columns.iter().map(|c| c.topic.as_str()).collect();
    let cross = distinct_topics.len() > 1;
    let topic_name = |slug: &str| {
        all.iter().find(|(s, _)| s == slug).map(|(_, m)| m.name.clone()).unwrap_or_else(|| slug.to_string())
    };

    // 類別表：單一主題原樣；跨主題合併並加前綴
    let mut categories = Vec::new();
    for slug in &distinct_topics {
        for c in db::categories_of(conn, slug)? {
            if cross {
                categories.push(CategoryDef {
                    id: format!("{slug}:{}", c.id),
                    label: format!("{}・{}", c.label, topic_name(slug)),
                    glyph: c.glyph,
                });
            } else {
                categories.push(c);
            }
        }
    }

    let mut regions = Vec::new();
    for (i, col) in view.columns.iter().enumerate() {
        let meta = db::regions_of(conn, &col.topic)?
            .into_iter()
            .find(|r| r.id == col.region)
            .ok_or_else(|| anyhow!("View「{}」的欄位 {}/{} 不存在", view.name, col.topic, col.region))?;

        let mut periods: Vec<Period> = db::periods_of(conn, &col.topic, &col.region)?
            .into_iter()
            .filter(|p| p.end >= timeline.min_year && p.start <= timeline.max_year)
            .collect();
        for p in &mut periods {
            let clamped = p.start < timeline.min_year || p.end > timeline.max_year;
            p.start = p.start.max(timeline.min_year);
            p.end = p.end.min(timeline.max_year);
            if clamped {
                let note = format!("（起訖已夾在此 View 的範圍內）");
                p.note = Some(match &p.note {
                    Some(n) => format!("{n}{note}"),
                    None => note,
                });
            }
        }

        let all_events = db::events_of(conn, &col.topic, &col.region)?;
        let total = all_events.len();
        let mut events: Vec<Event> = all_events
            .into_iter()
            .filter(|e| e.year >= timeline.min_year && e.end_year.unwrap_or(e.year) <= timeline.max_year)
            .collect();
        let outside = total - events.len();
        for e in &mut events {
            if col.importance_offset != 0 {
                e.importance = (e.importance + col.importance_offset).clamp(1, 5);
            }
            if cross {
                e.category = format!("{}:{}", col.topic, e.category);
                e.id = format!("{}:{}", col.topic, e.id);
            }
            // actualYear 是「真實年代早於這條軸的起點」。換了一條起點更晚的軸，
            // 原本的 year 本身可能就已經早於新起點而被濾掉；留下來的若 actualYear
            // 反而不早於新起點，前端 validate 會擋，這裡先清掉。
            if let Some(ay) = e.actual_year {
                if ay >= timeline.min_year {
                    e.actual_year = None;
                }
            }
        }

        let mut subtitle_parts = Vec::new();
        if cross {
            subtitle_parts.push(topic_name(&col.topic));
        }
        if let Some(s) = &meta.subtitle {
            subtitle_parts.push(s.clone());
        }
        if outside > 0 {
            subtitle_parts.push(format!("另有 {outside} 則不在此範圍"));
        }
        regions.push(RegionPayload {
            meta: RegionMeta {
                id: if cross { format!("{}:{}", col.topic, meta.id) } else { meta.id },
                name: meta.name,
                subtitle: if subtitle_parts.is_empty() { None } else { Some(subtitle_parts.join("・")) },
                order: i as i64,
            },
            periods,
            events,
        });
    }

    // 主題設定：內建 View 用主題自己的；使用者 View 合成一份
    let topic = if view.builtin {
        all.iter().find(|(s, _)| *s == view_id).map(|(_, m)| m.clone()).unwrap()
    } else {
        TopicMeta {
            name: view.name.clone(),
            title: None,
            description: format!(
                "跨主題組合：{}",
                view.columns
                    .iter()
                    .map(|c| format!("{}／{}", topic_name(&c.topic), c.region))
                    .collect::<Vec<_>>()
                    .join("、")
            ),
            column_label: "欄位".to_string(),
            jumps: None,
            default_ppy: view.default_ppy,
            order: view.order,
            root: None,
        }
    };

    // 切換清單：主題（內建 View）在前、使用者 View 在後
    let mut topics: Vec<TopicEntry> = Vec::new();
    for v in db::views_all(conn)? {
        let meta = if v.builtin {
            all.iter().find(|(s, _)| *s == v.id).map(|(_, m)| m.clone())
        } else {
            Some(TopicMeta {
                name: v.name.clone(),
                title: None,
                description: String::new(),
                column_label: "欄位".to_string(),
                jumps: None,
                default_ppy: v.default_ppy,
                order: v.order,
                root: None,
            })
        };
        let Some(meta) = meta else { continue };
        topics.push(TopicEntry {
            slug: v.id.clone(),
            href: format!("?view={}", v.id),
            is_current: v.id == view_id,
            timeline: Some(Timeline { min_year: v.min_year, max_year: v.max_year }),
            meta,
        });
    }

    Ok(ViewPayload { view_id, topic, timeline, categories, regions, topics })
}

fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

#[tauri::command]
pub fn get_view_payload(view: Option<String>, state: State<'_, AppState>) -> Result<ViewPayload, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    build_view_payload(&conn, view.as_deref()).map_err(err)
}

#[tauri::command]
pub fn list_views(state: State<'_, AppState>) -> Result<Vec<View>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::views_all(&conn).map_err(err)
}

#[tauri::command]
pub fn save_view(view: View, state: State<'_, AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::view_save(&mut conn, &view).map_err(err)
}

#[tauri::command]
pub fn delete_view(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::view_delete(&conn, &id).map_err(err)
}

/// 欄位選擇器用：所有主題與各自的欄位
#[tauri::command]
pub fn list_topic_catalog(state: State<'_, AppState>) -> Result<Vec<TopicCatalog>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    (|| -> Result<Vec<TopicCatalog>> {
        let mut out = Vec::new();
        for (slug, meta) in db::all_topics(&conn)? {
            let timeline = db::timeline_of(&conn, &slug)?.ok_or_else(|| anyhow!("{slug} 缺 timeline"))?;
            out.push(TopicCatalog { regions: db::regions_of(&conn, &slug)?, slug, meta, timeline });
        }
        out.sort_by(|a, b| {
            let oa = a.meta.order.unwrap_or(f64::INFINITY);
            let ob = b.meta.order.unwrap_or(f64::INFINITY);
            oa.partial_cmp(&ob).unwrap().then_with(|| a.slug.cmp(&b.slug))
        });
        Ok(out)
    })()
    .map_err(err)
}

/// 開發期：從 repo 的 YAML 重新載入上游資料
#[tauri::command]
pub fn reload_from_repo(state: State<'_, AppState>) -> Result<usize, String> {
    let dir = state.topics_dir.clone().ok_or("沒有設定資料來源（AOE_TOPICS_DIR）")?;
    let topics = crate::loader::load_topics(&dir).map_err(err)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::replace_upstream(&mut conn, &topics, "repo").map_err(err)?;
    Ok(topics.iter().map(|t| t.regions.iter().map(|r| r.events.len()).sum::<usize>()).sum())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> rusqlite::Connection {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src/topics");
        let topics = crate::loader::load_topics(&dir).expect("load repo YAML");
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        db::migrate(&mut conn).unwrap();
        db::replace_upstream(&mut conn, &topics, "test").unwrap();
        conn
    }

    #[test]
    fn payload_for_world_matches_web_shape() {
        let conn = fixture();
        let p = build_view_payload(&conn, Some("world")).unwrap();
        assert_eq!(p.view_id, "world");
        assert_eq!(p.timeline.min_year, -3000);
        assert_eq!(p.regions.len(), 4);
        assert_eq!(p.categories.len(), 6);
        assert_eq!(p.topics.len(), 8);
        assert!(p.topics.iter().any(|t| t.is_current && t.slug == "world"));
        // 單一主題：id 不加前綴
        assert!(p.regions[0].events[0].id.starts_with("tw-"));

        let root = build_view_payload(&conn, None).unwrap();
        assert_eq!(root.view_id, "taiwan");

        let json = serde_json::to_value(&p).unwrap();
        assert!(json["timeline"].get("minYear").is_some());
        assert!(json["topic"].get("columnLabel").is_some());
        let with_end = json["regions"].as_array().unwrap().iter()
            .flat_map(|r| r["events"].as_array().unwrap())
            .find(|e| e.get("endYear").is_some());
        assert!(with_end.is_some(), "endYear should serialize as camelCase");
    }

    #[test]
    fn cross_topic_view_merges_and_prefixes() {
        let mut conn = fixture();
        let v = View {
            id: "v-test".into(),
            name: "測試".into(),
            min_year: 1500,
            max_year: 2026,
            default_ppy: Some(4.0),
            order: None,
            builtin: false,
            columns: vec![
                ViewColumn { topic: "world".into(), region: "china".into(), importance_offset: 0 },
                ViewColumn { topic: "science".into(), region: "physical".into(), importance_offset: 1 },
                ViewColumn { topic: "art".into(), region: "music".into(), importance_offset: 0 },
            ],
        };
        db::view_save(&mut conn, &v).unwrap();
        let p = build_view_payload(&conn, Some("v-test")).unwrap();
        assert_eq!(p.regions.len(), 3);
        assert_eq!(p.regions[0].meta.id, "world:china");
        assert_eq!(p.timeline.min_year, 1500);
        // 類別合併 + 前綴；事件 category 也改寫；glyph 保留
        assert!(p.categories.len() > 6);
        assert!(p.categories.iter().all(|c| c.id.contains(':')));
        let e = &p.regions[1].events[0];
        assert!(e.category.starts_with("science:"));
        assert!(e.id.starts_with("science:"));
        assert!(p.categories.iter().any(|c| c.id == e.category));
        // 範圍：全部在 1500…2026
        assert!(p.regions.iter().flat_map(|r| &r.events).all(|e| e.year >= 1500));
        assert!(p.regions[0].meta.subtitle.as_deref().unwrap().contains("另有"));
        // 時期夾住
        assert!(p.regions.iter().flat_map(|r| &r.periods).all(|x| x.start >= 1500 && x.end <= 2026));
        // 切換清單含這個 View
        assert!(p.topics.iter().any(|t| t.slug == "v-test" && t.is_current));

        // 內建不能刪、不能改
        assert!(db::view_delete(&conn, "world").is_err());
        db::view_delete(&conn, "v-test").unwrap();
        assert!(db::view_get(&conn, "v-test").unwrap().is_none());
    }
}
