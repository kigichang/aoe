//! 從 repo 的 `src/topics/` 讀 YAML。**開發期的資料來源**；發布版走 bundle（PLAN.md §6）。
//!
//! 語意檢查是網站 `data.ts` 六道 assert 的移植：寧可載入失敗配一則明確訊息，
//! 也不要靜默掉資料——這是那份 CLAUDE.md 最在意的 bug 類型。

use crate::model::*;
use anyhow::{anyhow, bail, Context, Result};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

fn read_yaml<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let text = fs::read_to_string(path).with_context(|| format!("讀取 {}", path.display()))?;
    serde_saphyr::from_str(&text).map_err(|e| anyhow!("{} 資料格式錯誤：{e}", path.display()))
}

fn read_yaml_list<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Vec<T>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    // 空檔案（只有註解）serde 會給 None，視為空清單，跟 data.ts 的 `raw ?? []` 一樣
    let text = fs::read_to_string(path).with_context(|| format!("讀取 {}", path.display()))?;
    let v: Option<Vec<T>> =
        serde_saphyr::from_str(&text).map_err(|e| anyhow!("{} 資料格式錯誤：{e}", path.display()))?;
    Ok(v.unwrap_or_default())
}

pub fn load_topics(dir: &Path) -> Result<Vec<TopicData>> {
    let mut topics = Vec::new();
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .with_context(|| format!("讀取主題目錄 {}", dir.display()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_dir() && p.join("topic.yaml").exists())
        .collect();
    entries.sort();

    for topic_dir in entries {
        let slug = topic_dir.file_name().unwrap().to_string_lossy().to_string();
        topics.push(load_topic(&topic_dir, &slug)?);
    }
    if topics.is_empty() {
        bail!("找不到任何主題：{}/<主題>/topic.yaml 至少要有一份。", dir.display());
    }
    let roots: Vec<_> = topics.iter().filter(|t| t.meta.root == Some(true)).map(|t| t.slug.as_str()).collect();
    if roots.len() != 1 {
        bail!("恰好要有一個主題設定 root: true（目前有 {} 個：{}）。", roots.len(), roots.join("、"));
    }
    Ok(topics)
}

fn load_topic(dir: &Path, slug: &str) -> Result<TopicData> {
    let meta: TopicMeta = read_yaml(&dir.join("topic.yaml"))?;
    let timeline: Timeline = read_yaml(&dir.join("timeline.yaml"))
        .with_context(|| format!("主題 \"{slug}\" 缺少或無法讀取 timeline.yaml"))?;
    if timeline.max_year <= timeline.min_year {
        bail!("{slug}/timeline.yaml：maxYear 必須大於 minYear");
    }
    for y in meta.jumps.iter().flatten() {
        if *y < timeline.min_year || *y > timeline.max_year {
            bail!("{slug}/topic.yaml：跳轉年代 {y} 超出時間軸範圍 {}…{}", timeline.min_year, timeline.max_year);
        }
    }

    let cat_path = dir.join("categories.yaml");
    let categories: Vec<CategoryDef> = if cat_path.exists() { read_yaml(&cat_path)? } else { default_categories() };
    if categories.is_empty() || categories.len() > 6 {
        bail!("{slug}/categories.yaml：類別要在 1…6 個之間（識別靠漢字圖釘）");
    }
    for c in &categories {
        if c.glyph.chars().count() != 1 {
            bail!("{slug}/categories.yaml：類別 \"{}\" 的 glyph 必須剛好一個字", c.id);
        }
    }
    let cat_ids: HashSet<&str> = categories.iter().map(|c| c.id.as_str()).collect();

    let region_metas: Vec<RegionMeta> = read_yaml(&dir.join("regions.yaml"))
        .with_context(|| format!("主題 \"{slug}\" 缺少或無法讀取 regions.yaml"))?;
    assert_unique_ids(region_metas.iter().map(|r| r.id.as_str()), &format!("{slug}/regions.yaml"))?;

    let mut regions = Vec::new();
    for rm in region_metas {
        let rdir = dir.join(&rm.id);
        let where_ = format!("{slug}/{}", rm.id);
        let periods: Vec<Period> = read_yaml_list(&rdir.join("periods.yaml"))?;
        let events: Vec<Event> = read_yaml_list(&rdir.join("events.yaml"))?;

        assert_unique_ids(periods.iter().map(|p| p.id.as_str()), &format!("{where_}/periods.yaml"))?;
        assert_unique_ids(events.iter().map(|e| e.id.as_str()), &format!("{where_}/events.yaml"))?;
        assert_no_overlap(&periods, &where_)?;
        for p in &periods {
            if p.end < p.start {
                bail!("{where_}/periods.yaml：\"{}\" 的 end 不能早於 start", p.id);
            }
            assert_in_range(&p.id, p.start, p.end, &timeline, &format!("{where_}/periods.yaml"))?;
        }
        for e in &events {
            if e.year == 0 || e.end_year == Some(0) || e.actual_year == Some(0) {
                bail!("{where_}/events.yaml：\"{}\" 沒有西元 0 年", e.id);
            }
            if !(1..=5).contains(&e.importance) {
                bail!("{where_}/events.yaml：\"{}\" 的 importance 要在 1…5", e.id);
            }
            if let Some(ey) = e.end_year {
                if ey < e.year {
                    bail!("{where_}/events.yaml：\"{}\" 的 endYear 不能早於 year", e.id);
                }
            }
            if !cat_ids.contains(e.category.as_str()) {
                bail!(
                    "{where_}/events.yaml：\"{}\" 的類別 \"{}\" 不存在。主題 \"{slug}\" 可用的類別：{}",
                    e.id,
                    e.category,
                    cat_ids.iter().copied().collect::<Vec<_>>().join("、")
                );
            }
            if let Some(ay) = e.actual_year {
                if ay >= timeline.min_year {
                    bail!(
                        "{where_}/events.yaml：\"{}\" 的 actualYear ({ay}) 沒有早於時間軸起點 {}",
                        e.id, timeline.min_year
                    );
                }
            }
            assert_in_range(&e.id, e.year, e.end_year.unwrap_or(e.year), &timeline, &format!("{where_}/events.yaml"))?;
        }
        regions.push(RegionData { meta: rm, periods, events });
    }

    Ok(TopicData { slug: slug.to_string(), meta, timeline, categories, regions })
}

fn assert_unique_ids<'a>(ids: impl Iterator<Item = &'a str>, where_: &str) -> Result<()> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            bail!("{where_}：id 重複 \"{id}\"");
        }
    }
    Ok(())
}

/// 同一條 track 上的時期不可重疊，否則背景色帶會互相蓋掉
fn assert_no_overlap(periods: &[Period], where_: &str) -> Result<()> {
    let mut by_track: HashMap<i64, Vec<&Period>> = HashMap::new();
    for p in periods {
        by_track.entry(p.track).or_default().push(p);
    }
    for (track, mut list) in by_track {
        list.sort_by_key(|p| p.start);
        for w in list.windows(2) {
            let (prev, cur) = (w[0], w[1]);
            if cur.start <= prev.end {
                bail!(
                    "{where_} track {track}：時期重疊 — \"{}\"(…{}) 與 \"{}\"({}…)。請改用不同的 track。",
                    prev.name, prev.end, cur.name, cur.start
                );
            }
        }
    }
    Ok(())
}

fn assert_in_range(id: &str, from: Year, to: Year, t: &Timeline, where_: &str) -> Result<()> {
    if from < t.min_year || to > t.max_year {
        bail!("{where_}：\"{id}\" 的年份 {from}…{to} 超出時間軸範圍 {}…{}", t.min_year, t.max_year);
    }
    Ok(())
}
