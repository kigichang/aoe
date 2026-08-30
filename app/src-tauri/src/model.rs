//! 資料模型。**是網站 `src/lib/schema.ts` 的鏡像**，欄位名與選填性一對一
//! （`endYear` → `end_year` 靠 `rename_all = "camelCase"`）。改 schema.ts 時這裡要跟著改，
//! 前端 shim 會用 Zod 再驗一次，漏改會在載入時炸出明確訊息，不會靜默。
//!
//! 跟 Zod 一樣**忽略未知欄位**（serde 預設），所以 YAML 裡多一個欄位不會擋住載入。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Year = i64;

fn default_column_label() -> String {
    "地區".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicMeta {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub description: String,
    #[serde(default = "default_column_label")]
    pub column_label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jumps: Option<Vec<Year>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_ppy: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<bool>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub min_year: Year,
    pub max_year: Year,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryDef {
    pub id: String,
    pub label: String,
    pub glyph: String,
}

/// 沒有 `categories.yaml` 的主題沿用這一組（同 schema.ts 的 DEFAULT_CATEGORIES）
pub fn default_categories() -> Vec<CategoryDef> {
    [
        ("politics", "政治", "政"),
        ("war", "戰爭", "戰"),
        ("culture", "文化", "文"),
        ("science", "科技", "科"),
        ("religion", "宗教", "教"),
        ("economy", "經濟", "經"),
    ]
    .iter()
    .map(|(id, label, glyph)| CategoryDef {
        id: id.to_string(),
        label: label.to_string(),
        glyph: glyph.to_string(),
    })
    .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionMeta {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Period {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub track: i64,
    pub start: Year,
    pub end: Year,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub year: Year,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_year: Option<Year>,
    pub title: String,
    pub category: String,
    pub importance: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legendary: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_year: Option<Year>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<Source>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub links: Option<BTreeMap<String, String>>,
}

/// 一個主題讀完 YAML 之後的樣子（尚未入庫）。也是 bundle 裡每個主題的形狀
///（tools/bundle.mjs 產的 JSON 與這裡一對一）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicData {
    pub slug: String,
    pub meta: TopicMeta,
    pub timeline: Timeline,
    pub categories: Vec<CategoryDef>,
    pub regions: Vec<RegionData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionData {
    pub meta: RegionMeta,
    pub periods: Vec<Period>,
    pub events: Vec<Event>,
}

/* ---------------- 使用者事件 ---------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Placement {
    pub topic: String,
    pub region: String,
    /// 這個主題的類別 id（每個主題的類別表不同，所以掛在 placement 上）
    pub category: String,
}

/// 使用者自己加的事件。欄位對齊上游 Event，少了 actualYear／links（自訂事件用不到）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserEvent {
    /// "user/<uuid>"
    #[serde(rename = "ref")]
    pub r#ref: String,
    pub year: Year,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_year: Option<Year>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
    pub importance: i64,
    #[serde(default)]
    pub legendary: bool,
    #[serde(default)]
    pub sources: Vec<Source>,
    pub placements: Vec<Placement>,
}

/* ---------------- Tag 與關聯 ---------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub order: i64,
    /// 打了這個 tag 的事件數（唯讀，存檔時忽略）
    #[serde(default)]
    pub count: i64,
}

/// 一則事件的「現在」：給 tag 瀏覽、關聯清單、搜尋結果用。
/// `event_id` 是它在自己主題的 View 裡的 id（上游是原 id，使用者事件是 ref），
/// 前端拿來組 `?view={topic}#e={event_id}` 跳過去。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventHit {
    #[serde(rename = "ref")]
    pub r#ref: String,
    pub title: String,
    pub year: Year,
    pub topic: String,
    pub region: String,
    pub topic_name: String,
    pub region_name: String,
    pub event_id: String,
    /// ref 已經對不到任何事件（上游改了 id 或刪了），title 是快照
    pub orphan: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventLink {
    pub id: String,
    pub from: EventHit,
    pub to: EventHit,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInput {
    pub id: String,
    pub from_ref: String,
    pub to_ref: String,
    pub kind: String,
    #[serde(default)]
    pub note: Option<String>,
}

/* ---------------- 題庫 ---------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionEventRef {
    #[serde(rename = "ref")]
    pub r#ref: String,
    /// 快照；讀出時以現況為準
    #[serde(default)]
    pub title: String,
}

/// 題目。`options`／`answer` 依 kind：
/// - choice：options 是選項文字，answer 是正確選項的索引（number）
/// - year：options 空，answer 是 {"year": N, "tolerance": M}
/// - order：options 是**正確順序**的項目，answer 是 null（出題時打亂）
/// - flash：options 空，answer 是答案文字（自評）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub kind: String,
    pub prompt: String,
    #[serde(default)]
    pub options: Vec<String>,
    pub answer: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
    #[serde(default)]
    pub events: Vec<QuestionEventRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewState {
    pub ease: f64,
    pub interval_days: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    pub reps: i64,
    pub lapses: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_grade: Option<i64>,
}

impl Default for ReviewState {
    fn default() -> Self {
        Self { ease: 2.5, interval_days: 0, due_at: None, reps: 0, lapses: 0, last_grade: None }
    }
}

/// 題目 + 排程狀態 + 關聯事件的現況，給清單與練習用
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionCard {
    #[serde(flatten)]
    pub question: Question,
    pub review: ReviewState,
    pub hits: Vec<EventHit>,
    pub due: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizStats {
    pub total: i64,
    pub due: i64,
    pub wrong: i64,
    pub reviewed_today: i64,
}

/* ---------------- View ---------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewColumn {
    pub topic: String,
    pub region: String,
    #[serde(default)]
    pub importance_offset: i64,
}

/// 跨主題的欄位組合。內建的每主題一個（id = slug），其餘是使用者建的。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: String,
    pub name: String,
    pub min_year: Year,
    pub max_year: Year,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_ppy: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<f64>,
    #[serde(default)]
    pub builtin: bool,
    pub columns: Vec<ViewColumn>,
}

/// 給欄位選擇器用：每個主題有哪些欄位、時間軸多長
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicCatalog {
    pub slug: String,
    pub meta: TopicMeta,
    pub timeline: Timeline,
    pub regions: Vec<RegionMeta>,
    pub categories: Vec<CategoryDef>,
}

/* ---------------- 同步 ---------------- */

/// tools/bundle.mjs 產的 manifest.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: String,
    pub built_at: String,
    pub sha256: String,
    pub size: u64,
    pub event_count: u64,
    #[serde(default)]
    pub topic_count: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleInfo {
    pub version: String,
    pub imported_at: String,
    pub event_count: u64,
    pub topic_count: u64,
    /// 開發期直接讀 repo YAML 時為 true（同步功能不適用）
    pub from_repo: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCheck {
    pub local: BundleInfo,
    pub remote: Manifest,
    pub newer: bool,
}

/// 使用者資料裡指向已不存在事件的列
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Orphan {
    /// event_tag／event_link／question_event／placement
    pub kind: String,
    /// 刪除時用的鍵（各 kind 自己解讀）
    pub key: String,
    pub r#ref: String,
    pub snapshot: String,
    pub detail: String,
}

/* ---------------- 給前端的 payload（對齊 app/src/types.ts） ---------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPayload {
    #[serde(flatten)]
    pub meta: RegionMeta,
    pub periods: Vec<Period>,
    pub events: Vec<Event>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicEntry {
    pub slug: String,
    pub meta: TopicMeta,
    pub href: String,
    pub is_current: bool,
    pub timeline: Option<Timeline>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewPayload {
    pub view_id: String,
    pub topic: TopicMeta,
    pub timeline: Timeline,
    pub categories: Vec<CategoryDef>,
    pub regions: Vec<RegionPayload>,
    pub topics: Vec<TopicEntry>,
    /// 畫面上的事件 id → 全域 ref（"{topic}/{region}/{id}" 或 "user/…"）。
    /// 跨主題 View 的 id 有前綴、單一主題沒有，前端不該自己猜，這裡直接給。
    pub refs: std::collections::HashMap<String, String>,
}
