//! 前端 `invoke()` 的入口，與 app/src/api.ts 一對一。錯誤一律轉成 String 給前端顯示。

use crate::db;
use crate::model::*;
use crate::AppState;
use anyhow::{anyhow, bail, Context, Result};
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
    let mut refs = std::collections::HashMap::new();
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

        let mut all_events = db::events_of(conn, &col.topic, &col.region)?;
        // 使用者事件放在這一欄的也一起畫。id 是 ref（"user/…"），本來就全域唯一，
        // 不必再加主題前綴；前端靠這個前綴認出「這是自訂的」。
        all_events.extend(db::user_events_in_column(conn, &col.topic, &col.region)?);
        let total = all_events.len();
        let mut events: Vec<Event> = all_events
            .into_iter()
            .filter(|e| e.year >= timeline.min_year && e.end_year.unwrap_or(e.year) <= timeline.max_year)
            .collect();
        let outside = total - events.len();
        for e in &mut events {
            let r#ref = if e.id.starts_with("user/") { e.id.clone() } else { format!("{}/{}/{}", col.topic, col.region, e.id) };
            if col.importance_offset != 0 {
                e.importance = (e.importance + col.importance_offset).clamp(1, 5);
            }
            if cross {
                e.category = format!("{}:{}", col.topic, e.category);
                // 使用者事件的 ref 本身就全域唯一，且前端靠 "user/" 前綴認出它，不改
                if !e.id.starts_with("user/") {
                    e.id = format!("{}:{}", col.topic, e.id);
                }
            }
            // actualYear 是「真實年代早於這條軸的起點」。換了一條起點更晚的軸，
            // 原本的 year 本身可能就已經早於新起點而被濾掉；留下來的若 actualYear
            // 反而不早於新起點，前端 validate 會擋，這裡先清掉。
            if let Some(ay) = e.actual_year {
                if ay >= timeline.min_year {
                    e.actual_year = None;
                }
            }
            refs.insert(e.id.clone(), r#ref);
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

    Ok(ViewPayload { view_id, topic, timeline, categories, regions, topics, refs })
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
            out.push(TopicCatalog {
                regions: db::regions_of(&conn, &slug)?,
                categories: db::categories_of(&conn, &slug)?,
                slug,
                meta,
                timeline,
            });
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

#[tauri::command]
pub fn list_user_events(state: State<'_, AppState>) -> Result<Vec<UserEvent>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::user_events_all(&conn).map_err(err)
}

#[tauri::command]
pub fn get_user_event(r#ref: String, state: State<'_, AppState>) -> Result<Option<UserEvent>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::user_event_get(&conn, &r#ref).map_err(err)
}

#[tauri::command]
pub fn save_user_event(event: UserEvent, state: State<'_, AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::user_event_save(&mut conn, &event).map_err(err)
}

#[tauri::command]
pub fn delete_user_event(r#ref: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::user_event_delete(&conn, &r#ref).map_err(err)
}

/// 把使用者事件匯出成跟 src/topics 同格式的 YAML（每個 placement 一則，分主題／欄位），
/// 寫到 app data 目錄下的 export/，回傳寫了哪些檔。日後想回貢獻到 repo 直接複製。
#[tauri::command]
pub fn export_user_events(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    (|| -> Result<Vec<String>> {
        let events = db::user_events_all(&conn)?;
        let mut by_column: std::collections::BTreeMap<(String, String), Vec<Event>> = Default::default();
        for e in &events {
            for p in &e.placements {
                by_column.entry((p.topic.clone(), p.region.clone())).or_default().push(Event {
                    id: e.r#ref.trim_start_matches("user/").to_string(),
                    year: e.year,
                    end_year: e.end_year,
                    title: e.title.clone(),
                    category: p.category.clone(),
                    importance: e.importance,
                    desc: e.desc.clone(),
                    legendary: if e.legendary { Some(true) } else { None },
                    actual_year: None,
                    sources: if e.sources.is_empty() { None } else { Some(e.sources.clone()) },
                    links: None,
                });
            }
        }
        let dir = state.export_dir.clone();
        std::fs::create_dir_all(&dir)?;
        let mut written = Vec::new();
        for ((topic, region), list) in by_column {
            let path = dir.join(format!("{topic}--{region}.events.yaml"));
            let yaml = serde_saphyr::to_string(&list).map_err(|e| anyhow!("序列化 YAML：{e}"))?;
            std::fs::write(&path, format!("# 由 AoE 桌面版匯出的自訂事件（{topic}/{region}）\n{yaml}"))?;
            written.push(path.display().to_string());
        }
        Ok(written)
    })()
    .map_err(err)
}

/* ---------------- Tag ---------------- */

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::tags_all(&conn).map_err(err)
}
#[tauri::command]
pub fn save_tag(tag: Tag, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::tag_save(&conn, &tag).map_err(err)
}
#[tauri::command]
pub fn delete_tag(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::tag_delete(&conn, &id).map_err(err)
}
#[tauri::command]
pub fn get_event_tags(r#ref: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::event_tag_ids(&conn, &r#ref).map_err(err)
}
#[tauri::command]
pub fn set_event_tags(r#ref: String, tag_ids: Vec<String>, title: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::event_tags_set(&mut conn, &r#ref, &tag_ids, &title).map_err(err)
}
#[tauri::command]
pub fn list_event_tag_names(state: State<'_, AppState>) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::event_tag_names(&conn).map_err(err)
}
#[tauri::command]
pub fn events_with_tag(tag_id: String, state: State<'_, AppState>) -> Result<Vec<EventHit>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::events_with_tag(&conn, &tag_id).map_err(err)
}
#[tauri::command]
pub fn search_events(query: String, limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<EventHit>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::search_events(&conn, &query, limit.unwrap_or(30)).map_err(err)
}

/* ---------------- 關聯 ---------------- */

#[tauri::command]
pub fn list_links(r#ref: String, state: State<'_, AppState>) -> Result<Vec<EventLink>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::links_of(&conn, &r#ref).map_err(err)
}
#[tauri::command]
pub fn save_link(link: LinkInput, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::link_save(&conn, &link).map_err(err)
}
#[tauri::command]
pub fn delete_link(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::link_delete(&conn, &id).map_err(err)
}

/* ---------------- 題庫 ---------------- */

#[tauri::command]
pub fn list_questions(state: State<'_, AppState>) -> Result<Vec<QuestionCard>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::questions_all(&conn).map_err(err)
}
#[tauri::command]
pub fn get_question(id: String, state: State<'_, AppState>) -> Result<Option<QuestionCard>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::question_get(&conn, &id).map_err(err)
}
#[tauri::command]
pub fn questions_for_event(r#ref: String, state: State<'_, AppState>) -> Result<Vec<QuestionCard>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::questions_for_event(&conn, &r#ref).map_err(err)
}
#[tauri::command]
pub fn save_question(question: Question, state: State<'_, AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::question_save(&mut conn, &question).map_err(err)
}
#[tauri::command]
pub fn delete_question(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::question_delete(&conn, &id).map_err(err)
}
/// 匯入 CSV 或 Anki 純文字；回傳匯入的題數。全部驗證過才寫入，一筆錯就整批不寫。
#[tauri::command]
pub fn import_questions(text: String, source: String, state: State<'_, AppState>) -> Result<usize, String> {
    let qs = crate::quiz::parse_import(&text, &source).map_err(err)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    for q in &qs {
        db::question_save(&mut conn, q).map_err(err)?;
    }
    Ok(qs.len())
}
#[tauri::command]
pub fn quiz_queue(wrong_only: bool, limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<QuestionCard>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::questions_queue(&conn, wrong_only, limit.unwrap_or(50)).map_err(err)
}
#[tauri::command]
pub fn grade_question(id: String, grade: i64, elapsed_ms: Option<i64>, state: State<'_, AppState>) -> Result<ReviewState, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::grade_question(&mut conn, &id, grade, elapsed_ms).map_err(err)
}
#[tauri::command]
pub fn quiz_stats(state: State<'_, AppState>) -> Result<QuizStats, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::quiz_stats(&conn).map_err(err)
}

/* ---------------- 同步與孤兒 ---------------- */

/// manifest 與 bundle 的來源；`AOE_SYNC_BASE` 可以改（例如指到本機的 vite preview）
fn sync_base() -> String {
    std::env::var("AOE_SYNC_BASE").unwrap_or_else(|_| "https://aoe.kigi.tw/data".to_string())
}

fn http() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("aoe-app/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()?)
}

#[tauri::command]
pub fn bundle_info(state: State<'_, AppState>) -> Result<BundleInfo, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::bundle_info(&conn, state.topics_dir.is_some()).map_err(err)
}

/// 抓 manifest.json 比版本。網域走 Cloudflare 有快取，URL 加時間戳破快取。
#[tauri::command]
pub async fn sync_check(state: State<'_, AppState>) -> Result<SyncCheck, String> {
    let local = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::bundle_info(&conn, state.topics_dir.is_some()).map_err(err)?
    };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let url = format!("{}/manifest.json?t={now}", sync_base());
    let remote: Manifest = (async {
        let r = http()?.get(&url).send().await.with_context(|| format!("連線 {url}"))?;
        if !r.status().is_success() {
            bail!("{url} 回應 {}", r.status());
        }
        // **200 不代表檔案在。** 站台掛在 Cloudflare Pages，未知路徑回的是
        // 200 + index.html（不是 404）。少了這道檢查，錯誤訊息會是 serde 的
        // 「expected value at line 1」，看起來像 manifest 壞掉，而不是根本沒部署。
        let ct = r.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let body = r.text().await.context("讀取 manifest.json")?;
        if !ct.contains("json") && body.trim_start().starts_with('<') {
            bail!("{url} 回的是網頁不是 JSON（{ct}）——這個位址上多半還沒有部署資料 bundle。");
        }
        Ok::<_, anyhow::Error>(serde_json::from_str::<Manifest>(&body).context("manifest.json 格式")?)
    })
    .await
    .map_err(err)?;
    let newer = remote.version != local.version;
    Ok(SyncCheck { local, remote, newer })
}

/// 下載 bundle → 驗 sha256 → 解析並驗證 → 一個 transaction 換掉上游表。
/// 任何一步失敗都保留舊資料。回傳套用後的孤兒清單。
#[tauri::command]
pub async fn sync_apply(state: State<'_, AppState>) -> Result<(BundleInfo, Vec<Orphan>), String> {
    if state.topics_dir.is_some() {
        return Err("目前直接讀 repo 的 YAML（開發模式），不做線上同步。".into());
    }
    let base = sync_base();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (manifest, bytes) = (async {
        let c = http()?;
        let m: Manifest = c.get(format!("{base}/manifest.json?t={now}")).send().await?.error_for_status()?.json().await?;
        let b = c.get(format!("{base}/{}?v={}", m.url, m.version)).send().await?.error_for_status()?.bytes().await?;
        Ok::<_, anyhow::Error>((m, b.to_vec()))
    })
    .await
    .map_err(err)?;
    let got = crate::bundle::sha256_hex(&bytes);
    if got != manifest.sha256 {
        return Err(format!("下載的 bundle sha256 不符（manifest {}…，實際 {}…），不套用。", &manifest.sha256[..12], &got[..12]));
    }
    let bundle = crate::bundle::parse(&bytes).map_err(err)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::replace_upstream(&mut conn, &bundle.topics, &bundle.version).map_err(err)?;
    let info = db::bundle_info(&conn, false).map_err(err)?;
    let orphans = db::orphans(&conn).map_err(err)?;
    Ok((info, orphans))
}

#[tauri::command]
pub fn list_orphans(state: State<'_, AppState>) -> Result<Vec<Orphan>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::orphans(&conn).map_err(err)
}

#[tauri::command]
pub fn delete_orphan(kind: String, key: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::orphan_delete(&conn, &kind, &key).map_err(err)
}

/* ---------------- App 自身的更新 ---------------- */

/// 更新包是用自己的 minisign 金鑰簽的，**跟 Apple／Windows 的程式碼簽章是兩回事** ——
/// 驗的是「這包更新確實出自這把私鑰」，作業系統的 Gatekeeper／SmartScreen 仍然
/// 各管各的。這也是開發期不處理 Apple Developer 憑證仍然能發更新的原因。
///
/// 沒有新版回 `Ok(None)`；連不上、簽章不符都回 `Err`，由 UI 顯示原因 ——
/// 靜默失敗的話使用者會一直停在舊版而不自知。
#[tauri::command]
pub async fn app_update_check(app: tauri::AppHandle) -> Result<Option<AppUpdate>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let found = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(found.map(|u| AppUpdate {
        version: u.version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

/// 下載並安裝新版，然後重開。
///
/// **Windows 上安裝程式會先把目前這個行程關掉**，所以正常路徑上這個函式不會回傳，
/// 前端不要期待收到成功的回覆（收到 Err 才是真的有事）。
#[tauri::command]
pub async fn app_update_install(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Err("沒有可安裝的新版本。".into());
    };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart()
}

/// 開發用：前端效能基準把結果印到 stdout（tauri dev 的終端）
#[tauri::command]
pub fn log_perf(text: String) {
    eprintln!("{text}");
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

        // 使用者事件：放到兩個主題的欄位上，兩邊都看得到
        let ue = UserEvent {
            r#ref: "user/test-1".into(),
            year: 1687,
            end_year: None,
            title: "測試事件".into(),
            desc: None,
            importance: 5,
            legendary: false,
            sources: vec![],
            placements: vec![
                Placement { topic: "world".into(), region: "china".into(), category: "science".into() },
                Placement { topic: "science".into(), region: "physical".into(), category: "theory".into() },
            ],
        };
        db::user_event_save(&mut conn, &ue).unwrap();
        let p = build_view_payload(&conn, Some("v-test")).unwrap();
        let hits: Vec<_> = p.regions.iter().filter(|r| r.events.iter().any(|e| e.id == "user/test-1")).collect();
        assert_eq!(hits.len(), 2);
        let e = p.regions[1].events.iter().find(|e| e.id == "user/test-1").unwrap();
        assert_eq!(e.category, "science:theory");
        assert_eq!(e.importance, 5); // offset +1 後夾在 5
        // 單一主題 View 裡類別不加前綴
        let w = build_view_payload(&conn, Some("world")).unwrap();
        let e = w.regions.iter().flat_map(|r| &r.events).find(|e| e.id == "user/test-1").unwrap();
        assert_eq!(e.category, "science");
        // 驗證：類別不屬於該主題、年份超出範圍
        let mut bad = ue.clone();
        bad.placements[0].category = "theory".into();
        assert!(db::user_event_save(&mut conn, &bad).is_err());
        let mut bad = ue.clone();
        bad.year = 1400;
        bad.placements = vec![Placement { topic: "taiwan".into(), region: "china".into(), category: "war".into() }];
        assert!(db::user_event_save(&mut conn, &bad).is_err());
        // refs：單一主題 View 的 id 對到 "{topic}/{region}/{id}"，跨主題的去掉前綴，使用者事件對到自己
        assert_eq!(w.refs.get("cn-qin-unification").map(String::as_str), Some("world/china/cn-qin-unification"));
        let first = &p.regions[0].events[0].id;
        assert_eq!(p.refs.get(first).map(String::as_str), Some(format!("world/china/{}", first.trim_start_matches("world:")).as_str()));
        assert_eq!(p.refs.get("user/test-1").map(String::as_str), Some("user/test-1"));

        // Tag：層級、打標、含子 tag 的查詢、成環防護
        db::tag_save(&conn, &Tag { id: "t1".into(), parent_id: None, name: "科學革命".into(), color: None, order: 0, count: 0 }).unwrap();
        db::tag_save(&conn, &Tag { id: "t2".into(), parent_id: Some("t1".into()), name: "力學".into(), color: None, order: 0, count: 0 }).unwrap();
        let cyc = Tag { id: "t1".into(), parent_id: Some("t2".into()), name: "科學革命".into(), color: None, order: 0, count: 0 };
        assert!(db::tag_save(&conn, &cyc).is_err());
        db::event_tags_set(&mut conn, "world/china/cn-qin-unification", &["t2".into()], "秦滅六國").unwrap();
        db::event_tags_set(&mut conn, "user/test-1", &["t1".into()], "測試事件").unwrap();
        let hits = db::events_with_tag(&conn, "t1").unwrap();
        assert_eq!(hits.len(), 2, "含子 tag");
        assert!(hits.iter().all(|h| !h.orphan));
        assert!(hits.iter().any(|h| h.event_id == "cn-qin-unification" && h.topic == "world"));
        assert_eq!(db::tags_all(&conn).unwrap().iter().find(|t| t.id == "t2").unwrap().count, 1);
        // 搜尋索引：ref → 貼在它身上的名字，**不展開子孫**（祖先由前端補）
        let names = db::event_tag_names(&conn).unwrap();
        assert_eq!(names.len(), 2);
        assert_eq!(names.get("world/china/cn-qin-unification").unwrap(), &vec!["力學".to_string()]);
        assert_eq!(names.get("user/test-1").unwrap(), &vec!["科學革命".to_string()]);

        // 關聯：雙向查得到、不能自連、快照
        db::link_save(&conn, &LinkInput { id: "l1".into(), from_ref: "user/test-1".into(), to_ref: "world/china/cn-qin-unification".into(), kind: "對照".into(), note: None }).unwrap();
        assert!(db::link_save(&conn, &LinkInput { id: "l2".into(), from_ref: "user/test-1".into(), to_ref: "user/test-1".into(), kind: "x".into(), note: None }).is_err());
        let ls = db::links_of(&conn, "world/china/cn-qin-unification").unwrap();
        assert_eq!(ls.len(), 1);
        assert_eq!(ls[0].from.title, "測試事件");
        // 搜尋
        assert!(db::search_events(&conn, "秦滅", 10).unwrap().iter().any(|h| h.event_id == "cn-qin-unification"));

        // 刪掉使用者事件後，關聯與 tag 變孤兒但還讀得到快照
        db::user_event_delete(&conn, "user/test-1").unwrap();
        assert!(db::user_event_get(&conn, "user/test-1").unwrap().is_none());
        let ls = db::links_of(&conn, "world/china/cn-qin-unification").unwrap();
        assert!(ls[0].from.orphan && ls[0].from.title == "測試事件");

        // 題庫：存題、掛事件、佇列、評分、錯題本、統計
        let q = Question {
            id: "q1".into(),
            kind: "choice".into(),
            prompt: "秦滅六國是哪一年？".into(),
            options: vec!["-221".into(), "-206".into()],
            answer: serde_json::json!(0),
            explanation: None,
            source_file: None,
            events: vec![QuestionEventRef { r#ref: "world/china/cn-qin-unification".into(), title: String::new() }],
        };
        db::question_save(&mut conn, &q).unwrap();
        let c = db::question_get(&conn, "q1").unwrap().unwrap();
        assert!(c.due && c.hits[0].event_id == "cn-qin-unification" && !c.question.events[0].title.is_empty());
        assert_eq!(db::questions_for_event(&conn, "world/china/cn-qin-unification").unwrap().len(), 1);
        assert_eq!(db::questions_queue(&conn, false, 10).unwrap().len(), 1);
        let r = db::grade_question(&mut conn, "q1", 5, Some(1200)).unwrap();
        assert_eq!((r.reps, r.interval_days), (1, 1));
        assert_eq!(db::questions_queue(&conn, false, 10).unwrap().len(), 0, "評分後明天才到期");
        assert_eq!(db::questions_queue(&conn, true, 10).unwrap().len(), 0);
        db::grade_question(&mut conn, "q1", 1, None).unwrap();
        assert_eq!(db::questions_queue(&conn, true, 10).unwrap().len(), 1, "答錯進錯題本");
        let st = db::quiz_stats(&conn).unwrap();
        assert_eq!((st.total, st.wrong, st.reviewed_today), (1, 1, 1));
        let mut bad = q.clone();
        bad.answer = serde_json::json!(7);
        assert!(db::question_save(&mut conn, &bad).is_err());

        // 孤兒：刪掉使用者事件後，tag／關聯／題目變孤兒；能列出、能刪
        let orphans = db::orphans(&conn).unwrap();
        assert!(orphans.iter().any(|o| o.kind == "event_link" && o.snapshot == "測試事件"));
        assert!(orphans.iter().any(|o| o.kind == "event_tag" && o.r#ref == "user/test-1"));
        for o in &orphans {
            db::orphan_delete(&conn, &o.kind, &o.key).unwrap();
        }
        assert!(db::orphans(&conn).unwrap().is_empty());

        // 內嵌 bundle 解析得出來，且跟 YAML 同一套檢查
        let b = crate::bundle::parse(crate::bundle::EMBEDDED).unwrap();
        assert_eq!(b.topics.len(), 8);
        let n: usize = b.topics.iter().map(|t| t.regions.iter().map(|r| r.events.len()).sum::<usize>()).sum();
        assert!(n > 3000, "{n}");
        assert_eq!(crate::bundle::sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

        // 內建不能刪、不能改
        assert!(db::view_delete(&conn, "world").is_err());
        db::view_delete(&conn, "v-test").unwrap();
        assert!(db::view_get(&conn, "v-test").unwrap().is_none());
    }
}
