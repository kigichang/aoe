mod commands;
mod db;
mod loader;
mod model;

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
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let mut conn = db::open(&data_dir.join("aoe.sqlite"))?;
            let dir = topics_dir();
            // 開發期每次啟動都從 YAML 重建，改了資料重開就看得到；
            // 失敗就讓 App 起不來並印出原因——跟網站「載入期整片白配明確訊息」同一個精神。
            if let Some(d) = &dir {
                let topics = loader::load_topics(d).map_err(|e| format!("{e:#}"))?;
                db::replace_upstream(&mut conn, &topics, "repo").map_err(|e| format!("{e:#}"))?;
            }
            app.manage(AppState { db: Mutex::new(conn), topics_dir: dir, export_dir: data_dir.join("export") });
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
            commands::list_tag_groups,
            commands::save_tag_group,
            commands::delete_tag_group,
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
            commands::reload_from_repo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
