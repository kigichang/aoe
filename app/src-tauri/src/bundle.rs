//! 資料 bundle：安裝檔內嵌的那份、以及從 aoe.kigi.tw/data/ 下載的那份。
//! 格式由 tools/bundle.mjs 決定（gzip 的 JSON，`{version, builtAt, topics: TopicData[]}`）。

use crate::model::*;
use anyhow::{anyhow, bail, Context, Result};
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::io::Read;

/// 建置時內嵌的 bundle（build.rs 保證檔案存在）
pub static EMBEDDED: &[u8] = include_bytes!("../data/data-bundle.json.gz");

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub version: String,
    #[allow(dead_code)]
    pub built_at: String,
    pub topics: Vec<TopicData>,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let d = Sha256::digest(bytes);
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// 解壓、解析、跑跟 YAML 載入同一套語意檢查。任何一步失敗都不該碰資料庫。
pub fn parse(gz: &[u8]) -> Result<Bundle> {
    let mut json = String::new();
    GzDecoder::new(gz).read_to_string(&mut json).context("解壓 bundle")?;
    let b: Bundle = serde_json::from_str(&json).map_err(|e| anyhow!("bundle 格式錯誤：{e}"))?;
    if b.topics.is_empty() {
        bail!("bundle 裡沒有任何主題");
    }
    crate::loader::validate_topics(&b.topics)?;
    Ok(b)
}
