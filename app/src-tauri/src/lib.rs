mod bundle;
mod commands;
mod db;
mod loader;
mod model;
mod quiz;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    /// 開發期的資料來源：repo 的 src/topics。發布版是 None，資料來自內嵌／下載的 bundle。
    pub topics_dir: Option<PathBuf>,
    /// 匯出檔放這裡（app data 目錄下的 export/）
    pub export_dir: PathBuf,
}

/// 資料來源目錄：`AOE_TOPICS_DIR` 優先；debug 建置預設指到 repo 的 src/topics。
fn topics_dir() -> Option<PathBuf> {
    // AOE_NO_REPO=1：即使是 debug 建置也走 bundle 模式（測同步用）
    if std::env::var("AOE_NO_REPO").is_ok() {
        return None;
    }
    if let Ok(p) = std::env::var("AOE_TOPICS_DIR") {
        return Some(PathBuf::from(p));
    }
    if cfg!(debug_assertions) {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src/topics");
        if p.is_dir() {
            return Some(p.canonicalize().unwrap_or(p));
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let mut conn = db::open(&data_dir.join("aoe.sqlite"))?;
            let dir = topics_dir();
            // 開發期每次啟動都從 YAML 重建，改了資料重開就看得到；
            // 失敗就讓 App 起不來並印出原因——跟網站「載入期整片白配明確訊息」同一個精神。
            if let Some(d) = &dir {
                let topics = loader::load_topics(d).map_err(|e| format!("{e:#}"))?;
                db::replace_upstream(&mut conn, &topics, "repo").map_err(|e| format!("{e:#}"))?;
            } else if !db::has_upstream(&conn).map_err(|e| format!("{e:#}"))? {
                // 發布版第一次啟動：用安裝檔內嵌的 bundle，離線也有完整資料。
                // 之後的更新由使用者在「資料」面板按「檢查更新」。
                let b = bundle::parse(bundle::EMBEDDED).map_err(|e| format!("{e:#}"))?;
                db::replace_upstream(&mut conn, &b.topics, &b.version).map_err(|e| format!("{e:#}"))?;
            }
            app.manage(AppState { db: Mutex::new(conn), topics_dir: dir, export_dir: data_dir.join("export") });
            // 開發用：AOE_START_QUERY="view=v-perf&perf=1" 讓視窗一開就載入指定的 View（效能基準用）
            if let Ok(q) = std::env::var("AOE_START_QUERY") {
                if let Some(w) = app.get_webview_window("main") {
                    let mut url = w.url()?;
                    // 「query#fragment」兩段都可以給，例如 view=v-perf&perf=1#y=1600&z=4
                    let (query, frag) = q.split_once('#').unwrap_or((q.as_str(), ""));
                    url.set_query(Some(query));
                    url.set_fragment(if frag.is_empty() { None } else { Some(frag) });
                    w.navigate(url)?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_view_payload,
            commands::list_views,
            commands::save_view,
            commands::delete_view,
            commands::list_topic_catalog,
            commands::list_user_events,
            commands::get_user_event,
            commands::save_user_event,
            commands::delete_user_event,
            commands::export_user_events,
            commands::list_tags,
            commands::save_tag,
            commands::delete_tag,
            commands::get_event_tags,
            commands::set_event_tags,
            commands::events_with_tag,
            commands::search_events,
            commands::list_links,
            commands::save_link,
            commands::delete_link,
            commands::list_questions,
            commands::get_question,
            commands::questions_for_event,
            commands::save_question,
            commands::delete_question,
            commands::import_questions,
            commands::quiz_queue,
            commands::grade_question,
            commands::quiz_stats,
            commands::log_perf,
            commands::bundle_info,
            commands::sync_check,
            commands::sync_apply,
            commands::list_orphans,
            commands::delete_orphan,
            commands::app_update_check,
            commands::app_update_install,
            commands::reload_from_repo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
