//! 題庫：SM-2 排程、CSV／Anki 匯入的解析。純函式放這裡，方便測試；SQL 在 db.rs。

use crate::model::*;
use anyhow::{bail, Result};

/// SM-2（SuperMemo 2）。grade 0…5，>= 3 算答對。
/// 回傳新的 (ease, interval_days, reps, lapses)。
pub fn sm2(state: &ReviewState, grade: i64) -> ReviewState {
    let g = grade.clamp(0, 5);
    let mut s = state.clone();
    if g >= 3 {
        s.interval_days = match s.reps {
            0 => 1,
            1 => 6,
            _ => ((s.interval_days as f64) * s.ease).round().max(1.0) as i64,
        };
        s.reps += 1;
    } else {
        s.reps = 0;
        s.interval_days = 1;
        s.lapses += 1;
    }
    let q = (5 - g) as f64;
    s.ease = (s.ease + 0.1 - q * (0.08 + q * 0.02)).max(1.3);
    s.last_grade = Some(g);
    s
}

/// 檢查題目形狀是否對得上 kind
pub fn validate_question(q: &Question) -> Result<()> {
    if q.prompt.trim().is_empty() {
        bail!("題目不能是空的");
    }
    match q.kind.as_str() {
        "choice" => {
            let n = q.options.len();
            if !(2..=6).contains(&n) {
                bail!("單選題要有 2…6 個選項");
            }
            match q.answer.as_u64() {
                Some(i) if (i as usize) < n => {}
                _ => bail!("單選題的 answer 要是選項的索引（0 起算）"),
            }
        }
        "year" => {
            let y = q.answer.get("year").and_then(|v| v.as_i64());
            if y.is_none() || y == Some(0) {
                bail!("年份題的 answer 要是 {{\"year\": N, \"tolerance\": M}}，沒有西元 0 年");
            }
        }
        "order" => {
            if q.options.len() < 2 {
                bail!("排序題至少要兩個項目");
            }
        }
        "flash" => {
            if q.answer.as_str().map(|s| s.trim().is_empty()).unwrap_or(true) {
                bail!("問答題的答案不能是空的");
            }
        }
        k => bail!("未知的題型 \"{k}\"（choice／year／order／flash）"),
    }
    Ok(())
}

/// 匯入格式：
/// - **CSV**（有表頭 `kind,prompt,options,answer,explanation,events`）：
///   options 與 events 用 `|` 分隔；answer 依題型：choice 是索引、year 是 `1600` 或 `1600±5`、
///   order 留空（順序就是 options 的順序）、flash 是答案文字。
/// - **Anki 純文字**（tab 分隔，`正面<TAB>背面`，沒有表頭）：全部匯成 flash。
/// 自動判斷：第一行含 `kind` 且以逗號分隔就是 CSV。
pub fn parse_import(text: &str, source: &str) -> Result<Vec<Question>> {
    let text = text.trim_start_matches('\u{feff}');
    let first = text.lines().next().unwrap_or("");
    if first.contains("kind") && first.contains(',') {
        parse_csv(text, source)
    } else {
        parse_anki(text, source)
    }
}

fn parse_anki(text: &str, source: &str) -> Result<Vec<Question>> {
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(3, '\t');
        let front = parts.next().unwrap_or("").trim();
        let back = parts.next().unwrap_or("").trim();
        if front.is_empty() || back.is_empty() {
            bail!("第 {} 行：Anki 純文字每行要是「正面<TAB>背面」", i + 1);
        }
        out.push(Question {
            id: new_id("q"),
            kind: "flash".into(),
            prompt: strip_html(front),
            options: vec![],
            answer: serde_json::Value::String(strip_html(back)),
            explanation: None,
            source_file: Some(source.to_string()),
            events: vec![],
        });
    }
    if out.is_empty() {
        bail!("沒有讀到任何題目");
    }
    Ok(out)
}

fn strip_html(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").trim().to_string()
}

/// 夠用的 CSV 剖析：逗號分隔、雙引號包住可含逗號與換行、`""` 是引號本身
fn split_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted => {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    cell.push('"');
                } else {
                    quoted = false;
                }
            }
            '"' if cell.is_empty() => quoted = true,
            ',' if !quoted => {
                row.push(std::mem::take(&mut cell));
            }
            '\r' if !quoted => {}
            '\n' if !quoted => {
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            _ => cell.push(c),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows.into_iter().filter(|r| r.iter().any(|c| !c.trim().is_empty())).collect()
}

fn parse_csv(text: &str, source: &str) -> Result<Vec<Question>> {
    let rows = split_csv(text);
    let header: Vec<String> = rows.first().map(|h| h.iter().map(|s| s.trim().to_lowercase()).collect()).unwrap_or_default();
    let col = |name: &str| header.iter().position(|h| h == name);
    let (Some(ik), Some(ip), Some(ia)) = (col("kind"), col("prompt"), col("answer")) else {
        bail!("CSV 表頭至少要有 kind、prompt、answer（另可有 options、explanation、events）");
    };
    let io = col("options");
    let ie = col("explanation");
    let iev = col("events");
    let get = |r: &Vec<String>, i: Option<usize>| i.and_then(|i| r.get(i)).map(|s| s.trim().to_string()).unwrap_or_default();

    let mut out = Vec::new();
    for (n, r) in rows.iter().enumerate().skip(1) {
        let kind = get(r, Some(ik)).to_lowercase();
        let prompt = get(r, Some(ip));
        let options: Vec<String> = get(r, io).split('|').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        let ans = get(r, Some(ia));
        let answer = match kind.as_str() {
            "choice" => {
                let i: u64 = ans.parse().map_err(|_| anyhow::anyhow!("第 {} 行：單選題的 answer 要是索引", n + 1))?;
                serde_json::json!(i)
            }
            "year" => {
                let (y, tol) = match ans.split_once('±') {
                    Some((y, t)) => (y.trim(), t.trim().parse::<i64>().unwrap_or(0)),
                    None => (ans.as_str(), 0),
                };
                let y: i64 = y.parse().map_err(|_| anyhow::anyhow!("第 {} 行：年份題的 answer 要是整數（可加 ±N）", n + 1))?;
                serde_json::json!({ "year": y, "tolerance": tol })
            }
            "order" => serde_json::Value::Null,
            "flash" => serde_json::Value::String(ans),
            k => bail!("第 {} 行：未知的題型 \"{k}\"", n + 1),
        };
        let events: Vec<QuestionEventRef> = get(r, iev)
            .split('|')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| QuestionEventRef { r#ref: s.to_string(), title: String::new() })
            .collect();
        let q = Question {
            id: new_id("q"),
            kind,
            prompt,
            options,
            answer,
            explanation: Some(get(r, ie)).filter(|s| !s.is_empty()),
            source_file: Some(source.to_string()),
            events,
        };
        validate_question(&q).map_err(|e| anyhow::anyhow!("第 {} 行：{e}", n + 1))?;
        out.push(q);
    }
    if out.is_empty() {
        bail!("沒有讀到任何題目");
    }
    Ok(out)
}

pub fn new_id(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{prefix}-{:x}", t ^ (std::process::id() as u128) << 64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sm2_schedule() {
        let s0 = ReviewState::default();
        let s1 = sm2(&s0, 4);
        assert_eq!((s1.interval_days, s1.reps, s1.lapses), (1, 1, 0));
        let s2 = sm2(&s1, 5);
        assert_eq!((s2.interval_days, s2.reps), (6, 2));
        let s3 = sm2(&s2, 4);
        assert!(s3.interval_days >= 15, "{}", s3.interval_days);
        let s4 = sm2(&s3, 1);
        assert_eq!((s4.interval_days, s4.reps, s4.lapses), (1, 0, 1));
        assert!(s4.ease >= 1.3);
        // 連續答錯 ease 不會低於 1.3
        let mut s = s4;
        for _ in 0..20 {
            s = sm2(&s, 0);
        }
        assert!((s.ease - 1.3).abs() < 1e-9);
    }

    #[test]
    fn import_csv_and_anki() {
        let csv = "kind,prompt,options,answer,explanation,events\n\
choice,關原之戰是哪一年？,1598|1600|1603,1,德川家康勝出,taiwan/japan/jp-sekigahara\n\
year,大坂之陣哪一年結束？,,1615±1,,\n\
order,依先後排序,本能寺之變|關原之戰|大坂之陣,,,\n\
flash,\"誰在關原之戰勝出？\",,\"德川家康，東軍\",,\n";
        let qs = parse_import(csv, "t.csv").unwrap();
        assert_eq!(qs.len(), 4);
        assert_eq!(qs[0].kind, "choice");
        assert_eq!(qs[0].answer, serde_json::json!(1));
        assert_eq!(qs[0].events[0].r#ref, "taiwan/japan/jp-sekigahara");
        assert_eq!(qs[1].answer["tolerance"], 1);
        assert_eq!(qs[2].options.len(), 3);
        assert_eq!(qs[3].answer, "德川家康，東軍");

        let anki = "關原之戰<b>哪一年</b>？\t1600\n大坂之陣哪一年？\t1614–1615\n";
        let qs = parse_import(anki, "deck.txt").unwrap();
        assert_eq!(qs.len(), 2);
        assert_eq!(qs[0].kind, "flash");
        assert_eq!(qs[0].prompt, "關原之戰哪一年？");
    }
}
