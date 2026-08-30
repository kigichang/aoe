# AoE 桌面版（Windows／macOS）實作計畫 — Tauri 2

## Context

網站 `aoe` 已累積 8 個主題、2,617 則事件、269 段時期（`src/topics/**`），是唯讀的並排時間軸。
要做桌面 App，**沿用現行網站的畫面與操作、不改動 Web 版的行為**，並新增：

1. 跨主題並列：把不同主題的欄位（`world/china` + `science/physical` + `art/music`）放在同一條軸上。
2. 使用者自行新增事件，一則事件可放到多個主題的欄位上。
3. 事件加多組 Tag（有分組／層級）並建立明確的有向關聯。
4. 題庫：自行出題、匯入既有題庫檔、錯題本走間隔重複。

使用者決定：**Tauri 2**（前端沿用現有 React/TS，後端 Rust）；桌面版的操作會比 Web 複雜；要一併考慮虛擬化。
Windows 先公開發布；macOS 開發期不處理 Apple 簽章。工作目錄 `app/`（目前不存在；分支 `app`）。

---

## 1. 為什麼 Tauri 適合這個需求

| 需求 | Tauri 的對應 |
|---|---|
| 沿用網站畫面 | 前端就是現有的 `src/components`／`src/lib`／`styles.css`，透過 Vite alias 直接 import，**零複製**。 |
| 桌面操作更複雜 | 編輯器、題庫、匯入等新 UI 用 React 在 `app/src/` 加，跟網站元件並存；需要的話開第二個視窗（Tauri 多視窗）。 |
| 本地資料 | Rust 端 `rusqlite`，型別安全、交易、migration；前端只呼叫 `invoke()`。 |
| 體積／更新 | 安裝檔 ~10MB；`tauri-plugin-updater` 用自己的 minisign 金鑰簽更新包，**與 Apple 憑證無關**，Windows 可直接用。 |
| Windows | WebView2（Win10/11 內建），NSIS 安裝檔可帶 evergreen bootstrapper。 |
| macOS | 開發期 `tauri build` 出未簽章 .app，自己用 右鍵→開啟；日後補 Developer ID + notarize 只是加設定。 |

---

## 2. 核心難題：網站把「主題」當模組層常數

`data.ts` 用 `import.meta.glob` 在模組層算出 `TOPIC / TIMELINE / REGIONS / CATEGORIES`，
`scale.ts` 再從它推 `MIN_YEAR / MAX_YEAR / SPAN_YEARS`。CLAUDE.md 明言**不要改成 state**，
換主題就整頁重載。

**桌面版順著這個設計走，不對抗它**：一個「View」（跨主題欄位組合）= 一次 WebView 載入。

```
app/index.html
  └─ bootstrap.ts   invoke('get_view_payload', {viewId})  ← 從 URL ?view= 讀
        └─ window.__AOE_DATA__ = payload
        └─ await import('./main.tsx')   ← 這時才載入 React 與網站程式碼
```

`app/src/shims/data.ts` 用 **Vite `resolve.alias` 精準替換 `src/lib/data.ts`**（只換這一支），
從 `window.__AOE_DATA__` **同步**建出跟原本一模一樣的匯出（`TOPIC`、`TOPICS`、`TIMELINE`、`REGIONS`、
`CATEGORIES`、`CATEGORY_IDS`、`HAS_TRUNCATED_EVENTS`、`TOPIC_ID`）。`scale.ts`／`search.ts`／所有元件**一行不改**。
同理 alias 掉 `src/lib/topic.ts`（它讀 `window.location.pathname`）。

切換 View／主題 = `location.href = '?view=<id>'` 整頁重載，跟網站 `TopicSwitcher` 的 `<a href>` 行為一致；
shim 產出的 `TOPICS[].href` 就填這個。

跨主題時的對應規則（在 Rust 組 payload 時處理，前端無感）：
- **類別**：各主題類別表合併，id 加主題前綴（`science:discovery`），事件的 `category` 一併改寫；
  `glyph` 取自事件自己的主題。shim 不套 `categoryListSchema.max(6)`（那是編輯資料時的規則，不是顯示規則）。
- **欄位 slot**：依 View 內順序 0…n；超過 4 欄 UI 顯示「相鄰配色未驗證」提示，不擋。
- **範圍**：View 有自己的 `min/max_year`；落在範圍外的事件**不進 payload，但欄位 `subtitle` 附「另有 N 則不在此範圍」**——
  不讓 `assertInRange` 炸、也不靜默消失。
- **importance**：各主題尺規不同（`taiwan` 的 5 是台灣史最重要）。View 每欄可設 `importance_offset`（-2…+2，預設 0），
  Rust 組 payload 時套用並夾在 1…5。
- **使用者事件**：出現在它每個 placement 對應的欄位，`ref` 以 `user/` 開頭，元件照常畫。

### 網站程式碼「需要」動的最小範圍（行為不變）

1. `src/lib/data.ts` 的六道 assert 抽到 `src/lib/validate.ts` 匯出（純搬移），shim 與 Node 端打包工具都能重用，
   不必再寫第二份。
2. `src/App.tsx` 加幾個**選填的擴充點**：`toolbarExtra?: ReactNode`、`detailExtra?: (e: HistEvent) => ReactNode`、
   `onEventAction?: (e, action) => void`。網站不傳 → 畫面與現在完全相同。
   桌面版靠這些掛上「編輯／貼 Tag／出題／相關題目／關聯」的按鈕與區塊。
   （替代方案是把 `App.tsx` 複製一份到 app 裡改——縮放錨定、時間游標、欄位計算那 500 行會分岔，不採。）
3. `RegionColumn` 加選填的 `viewport?: {top, bottom}` 做剔除（見 §5）。網站不傳 → 全部渲染，跟現在一樣。

以上三項都是「不傳就等於現況」的加法，各自一個小 PR 進 `main`；其餘全部在 `app/`。

---

## 3. 專案結構

```
app/
  PLAN.md                    本計畫複本 + 進度勾選（使用者要求計畫放這裡）
  package.json               獨立的 npm 專案（deps：react、zod、@tauri-apps/api、@tauri-apps/plugin-*）
  vite.config.ts             alias：'/src/lib/data' → app/src/shims/data.ts，'/src/lib/topic' → shims/topic.ts
                             其餘 '@web/*' → ../src/*
  index.html + bootstrap.ts  見 §2
  src/
    main.tsx                 組裝：<App toolbarExtra=… detailExtra=… /> + 桌面專屬 Provider
    api.ts                   invoke() 的型別封裝（與 Rust command 一對一）
    shims/{data,topic}.ts
    views/                   View 管理：欄位選擇器（主題→欄位）、範圍、offset
    editor/                  事件編輯、placement、Tag 編輯（分組／層級）、關聯編輯
    quiz/                    出題、練習、錯題本、匯入
    sync/                    資料版本檢查、下載進度、孤兒檢查結果
  src-tauri/
    Cargo.toml               tauri 2、rusqlite(bundled)、rusqlite_migration、serde、sha2、reqwest
    src/main.rs
    src/db/{schema.sql, migrations, repo/*}
    src/commands/{view, events, tags, links, quiz, sync}.rs
    src/bundle.rs            讀 data-bundle.json → 重建上游表
    tauri.conf.json          bundle 設定、updater、CSP
  ../tools/bundle.mjs        （放 repo 根 tools/）src/topics → data-bundle.json + manifest.json
                             用 js-yaml + tsx 載入 schema.ts / validate.ts，Zod 是唯一的驗證來源
```

前端型別直接 `import type { HistEvent } from '@web/lib/schema'`；Rust 端 `serde` struct 欄位名跟 YAML 一致
（`endYear` 用 `#[serde(rename_all = "camelCase")]`）。

---

## 4. 本地資料：SQLite，上游／使用者分表

單一檔 `<app_data_dir>/aoe.sqlite`（Tauri `path::app_data_dir()`），WAL。**上游表可整批重建，使用者表永遠不動。**

### 上游（唯讀）
```
bundle_meta (version, sha256, built_at, imported_at)
topics      (slug PK, name, description, column_label, default_ppy, jumps_json, order_no, root)
timelines   (topic, min_year, max_year)
categories  (topic, id, label, glyph)              PK(topic,id)
regions     (topic, id, name, subtitle, order_no)  PK(topic,id)
periods     (topic, region, id, name, track, start, end, note)
events      (ref PK, topic, region, id, year, end_year, title, category, importance,
             desc, legendary, actual_year, sources_json, links_json)
```
**`ref = "{topic}/{region}/{id}"`** 是全 App 的事件主鍵：id 只在單一 region 檔內唯一（`assertUniqueIds` 逐檔跑），
且 `taiwan` 與 `world` 刻意共用 `tw-*` id 但獨立維護。

### 使用者（永久）
```
user_events      (ref PK "user/{uuid}", year, end_year, title, desc, importance, legendary, sources_json, created_at, updated_at)
event_placements (event_ref, topic, region, category)     -- category 掛 placement：每主題類別表不同
tag_groups       (id PK, name, order_no)
tags             (id PK, group_id, parent_id NULL, name, color)
event_tags       (event_ref, tag_id, title_snapshot)
event_links      (id PK, from_ref, to_ref, kind, note, title_snapshot_from, title_snapshot_to)
                  kind 自由字串，UI 預設：導致／回應／延續／對照
event_notes      (ref PK, note)                            -- 對上游事件的私人註記，不改上游欄位
views            (id PK, name, min_year, max_year, default_ppy, order_no, builtin)
view_columns     (view_id, topic, region, order_no, importance_offset)
questions        (id PK, kind, prompt, options_json, answer_json, explanation, source_file, created_at)
question_events  (question_id, event_ref, title_snapshot)
review_state     (question_id PK, ease, interval_days, due_at, reps, lapses)
review_log       (id, question_id, reviewed_at, grade, elapsed_ms)
```
指向上游 ref 的欄位**不設 FK**（上游會重建）。同步後跑**孤兒檢查**：列出指向不存在 ref 的 tag／link／question／placement，
交給使用者改連結或刪除，不自動刪；`title_snapshot` 讓孤兒還讀得懂。

內建 8 個 View（每主題一個，`builtin=1`，不可刪）。匯出：整個 sqlite 即備份；另可匯出 `user-events.yaml`／`tags.yaml`／`questions.yaml`。

---

## 5. 虛擬化

現況：`RegionColumn` 把整欄可見事件全部 `placeEvents` 後全部渲染。跨主題 View + 使用者事件後，
一個 View 可能 5–6 欄 × 300–700 則 ≈ 3,000 個 `.mark`（每個 3–4 個 DOM 節點），CLAUDE.md 的「2,000 則再考慮」門檻會被越過。

原則：**排版不虛擬化，渲染才虛擬化。** `placeEvents` 是 importance 優先的區間佔位，欄內任兩則都可能互相影響，
必須整欄一起算；算完之後只渲染落在視窗附近的，結果與全渲染完全相同（第一條不變式不受影響）。

分三步，每步量過再做下一步：

1. **免費的**：`.mark` 加 `contain: layout style paint`，`.lane-body` 加 `content-visibility: auto`（樣式改動，網站也受益）。
2. **memo**：`placeEvents` 的結果以 `(events, ppy, laneCount, filters)` 為 key 快取，捲動不重算。
3. **視窗剔除**：`RegionColumn` 接選填 `viewport?: {top, bottom}`（像素，含上下各一屏 buffer），
   只渲染 `y ∈ viewport` 的 mark 與引線；時期色帶（每欄 ≤ 40 段）不剔除。桌面版 `App` 從 `.scroller` 的 scrollTop 傳入
   （rAF 節流）。網站不傳 → 全渲染。

量測基準：建一個 `world` 四欄 + `science` 四欄 + 500 則使用者事件的 View（~2,000 則），
Chrome/WebView2 效能面板下捲動與縮放的 frame time；目標 < 16ms。步驟 3 只在步驟 1–2 後仍不達標才做。

**搜尋不受影響**：`search.ts` 是對資料比對，不是對 DOM；`revealEvent` 跳轉後 viewport 更新會把目標畫出來。

---

## 6. 同步：專案新資料如何到本地

**開發期**：`config.toml` 的 `data_source = { kind = "repo", path = ".../aoe/src/topics" }`，
Rust 啟動時執行 `node tools/bundle.mjs --stdout`？——不，避免 App 依賴 Node：Rust 端用 `serde-saphyr` 讀 YAML 直接入表，
驗證只做結構（serde 失敗即報錯），語意驗證（重疊、範圍、類別）已由 `npm run lint:data` 與網站載入把關。
按「重新載入資料」即重建上游表。

**發布**：
1. `tools/bundle.mjs` 在現有 `.github/workflows/deploy.yml` 加一個 step，push `main` 時產出
   `data-bundle.json.gz` + `manifest.json {version: "<date>.<sha7>", sha256, event_count}`，跟 Pages 一起部署到 `aoe.kigi.tw/data/`。
   ⚠ 網域走 Cloudflare 有快取（memory：aoe-domain-on-cloudflare-cname-only）——`manifest.json` 抓取時加 `?t=<now>`。
2. 安裝檔內嵌建置當下的 bundle（`include_bytes!`），首次啟動離線即有完整資料。
3. 啟動時（可關）抓 manifest，較新就下載、驗 sha256、一個 transaction 重建上游表、跑孤兒檢查。失敗保留舊資料並顯示原因。
4. App 更新：`tauri-plugin-updater` + GitHub Releases（`latest.json`），自簽 minisign。Windows 全自動；macOS 未簽章時只提示。

---

## 7. 題庫與錯題本

- 題型：**單選**（4 選項）、**年份**（容錯 ±N 年可設）、**排序**（3–5 則事件排先後）。
- 每題掛 0…n 則事件；事件詳情面板（`detailExtra`）顯示「相關題目」，答題頁可跳到事件。
- 出題輔助：事件詳情按「出題」預填（年份題／排序題自動帶事件）。
- 匯入：CSV（欄位對照 UI）、Anki 純文字匯出（tab 分隔）。`.apkg` 第二版。
- SM-2（前端純函式放 `app/src/quiz/srs.ts`，有單元測試），評分 0–5；`lapses > 0` 進錯題本，可依 tag／主題／事件篩。
- 練習模式：今日到期 → 錯題本 → 依 tag／View 自選。

---

## 8. 分階段

| Phase | 內容 | 完成判準 |
|---|---|---|
| **0 骨架** | `app/` Tauri 專案、alias 到 `../src`、`data.ts`／`topic.ts` shim 讀 `window.__AOE_DATA__`、Rust 讀 repo YAML 入 SQLite、`get_view_payload`。 | 桌面版開起來與網站 `world` 主題畫面一致，兩平台皆可。 |
| 1 網站三個小 PR | `validate.ts` 抽出、`App.tsx` 擴充點、`RegionColumn.viewport`（先只加 prop，不實作剔除）。 | 網站 build 通過、畫面無差異。 |
| 2 View | View CRUD、欄位選擇器、跨主題 payload（類別前綴、範圍外計數、offset）、切換 = 重載。 | `world/china + science/physical + art/music` 可正常瀏覽。 |
| 3 使用者事件 | 新增／編輯／刪除、多 placement、每 placement 選類別、範圍檢查、匯出 YAML。 | 同一事件出現在兩個主題的欄位。 |
| 4 Tag 與關聯 | tag_groups／tags 層級、貼 tag、有向 link、詳情「相關」區、依 tag 篩選。 | — |
| 5 題庫 | 出題、三題型、匯入、SM-2、錯題本、練習流程。 | — |
| 6 虛擬化 | §5 的量測與三步。 | 2,000 則 View 捲動 < 16ms。 |
| 7 同步與打包 | bundle 工具 + CI、manifest 檢查、孤兒檢查 UI、Windows NSIS + updater、macOS 未簽章 .app。 | 乾淨 Windows 機器可安裝、離線開啟、連線後同步一次。 |

Phase 1 的 PR 進 `main`；其餘在 `app` 分支。

---

## 9. 決策與注意事項

- **不動 `src/topics/`**；網站程式碼只做 §2 那三個「不傳就等於現況」的加法。
- **View = 一次 WebView 載入**，是刻意跟網站的「主題是 per-document 常數」對齊，不引入第二套資料流。
- `ref` 對上游是弱參照，孤兒檢查是唯一保護，UI 必做。
- 前端型別以 `schema.ts` 為準，Rust struct 是它的鏡像；改 schema 時兩邊都要改（跟 `HEAD_H`／`--head-h` 同類的手動同步，記在 `app/PLAN.md`）。
- Tauri CSP 要允許 `aoe.kigi.tw` 與 GitHub Releases 的連線；其餘關閉。
- Windows 無簽章 exe 有 SmartScreen 警告；公開發布前買憑證或接受「仍要執行」。

## 10. 驗證

- 每個 Phase：`npm run build`（網站）+ `npm run check`（app）+ `cargo test`（Rust repo 層）。
- Phase 0／2：桌面版與網站同一主題並排目視；用 `#e=` 跳到同一事件比對 y 座標。
- Phase 6：效能面板量 frame time。
- Phase 7：乾淨 Windows VM 安裝、離線啟動、連線同步。

## 11. 第一步

建 `app/` 骨架與 `app/PLAN.md`（本文複本 + 勾選欄），開始 Phase 0。

---

## 進度

- [x] Phase 0 骨架（2026-08-29）：`tauri dev` 可啟動，Rust 從 repo YAML 載入 8 主題／3,216 則事件／282 段時期入 SQLite，`get_view_payload` 有 `cargo test` 覆蓋；`vite build` 產物不含任何 YAML（shim 生效，主 chunk 296KB）。
- [x] Phase 1 網站擴充點（2026-08-29，分支 `web/extension-points`，已併入 app，尚未進 main）：`validate.ts` 抽出、`AppProps`（mastheadExtra／toolbarExtra／detailExtra／virtualize）、`RegionColumn.viewport` 直接實作剔除。桌面版 `main.tsx` 開 `virtualize`，shim 用 `validate.ts` 重跑語意檢查。實測跳轉 1945 後畫面完整。
- [x] Phase 2 View（2026-08-30）：migration 002、跨主題 payload 合併（類別／事件 id 加主題前綴、範圍外計數進副標、跨界時期夾住、每欄 offset）、「組合視圖」對話框。實測 world/china + science/physical + art/music、範圍 1500–2026：三欄各自的時期色帶、18 個帶主題後綴的類別 chip、詳情面板與同時期清單都正常。
  - 已知可改善：跨主題時類別 chip 一列擠 18 顆（每主題 6 顆），之後可依主題分組或收成下拉。
- [x] Phase 3 使用者事件（2026-08-30）：migration 003（user_events／event_placements）、`user_event_save` 驗證（欄位存在、類別屬於該主題、年份在該主題軸內）、payload 併入各欄、`export_user_events` 寫 `<app data>/export/<topic>--<region>.events.yaml`。前端 `EventEditor`（標題／年份／重要度／傳說／描述／多 placement 各選類別／出處），「＋ 事件」在標題列，詳情面板對 `user/` 開頭的事件顯示「自訂事件・編輯」。實測一則事件放到 taiwan/taiwan 與 world/china，兩邊都畫得出來、搜尋也找得到。
  - 跨主題 View 裡使用者事件的 id 不加主題前綴（ref 本身全域唯一，前端靠 `user/` 認它）。
  - 匯出還沒接 UI 按鈕，先留 command。
- [x] Phase 4 Tag 與關聯（2026-08-30）：migration 004（tag_groups／tags 有 parent／event_tags／event_links 都帶 title_snapshot）、成環防護、含子 tag 的查詢、全域事件搜尋（關聯目標可指到任何主題）、payload 加 `refs`（畫面 id → 全域 ref）。前端：詳情面板的 Tag（勾選＋快速新增）與關聯（搜尋→選目標→方向／類型／備註）、標題列「標籤」管理與依 tag 瀏覽、`gotoHit` 在同 View 內走 hash、跨 View 走 `?view=…#e=…`。實測：關原之戰貼 tag、關聯到大坂之陣、反向顯示、點擊跳轉、標籤面板列出事件。
  - 孤兒（ref 對不到事件）目前只在關聯／tag 清單裡以刪除線呈現，還沒有集中的孤兒檢查頁（Phase 7 同步時做）。
  - `window.prompt` 在 WKWebView 不可靠，取名改用對話框內的輸入列；`confirm` 可用。
- [x] Phase 5 題庫（2026-08-30）：migration 005（questions／question_events／review_state／review_log）、四種題型（單選／年份±N／排序／問答自評）、`quiz.rs` 的 SM-2 與 CSV／Anki 純文字剖析（有單元測試）、匯入一筆錯整批不寫、今日到期／錯題本佇列、統計。前端：題庫面板（練習／題目／匯入）、題目編輯器（含相關事件搜尋）、練習流程（自動評分：對 4 錯 1；問答自評 1／3／5）、詳情面板「題目／出題」（預填年份題）。實測匯入 4 題 CSV → 練習：單選答錯進錯題本、年份 ±1 答對、排序題打亂顯示、統計 2／1／4／2。
  - 題型比計畫多了 `flash`（問答自評），因為 Anki 匯入天然就是正面／背面。
  - `.apkg` 未做；CSV 的 events 欄要填全域 ref（`topic/region/id`），匯入時補標題快照。
- [x] Phase 6 虛擬化（2026-08-30）：`?perf=1` 自動基準（`src/perf.ts`，程式化捲動 + 12 次縮放，結果由 `log_perf` 印到 dev log；`AOE_START_QUERY` 讓視窗一開就載入指定 View）。8 欄 View（world×4 + science×4，1,392 則）、ppy=4、debug 建置 + React dev mode：

  | 設定 | DOM marks | 捲動 avg／p95 | 縮放 avg |
  |---|---|---|---|
  | 剔除關 | 1,393 | 16.9／17ms | 68ms |
  | 剔除開，步長 400 | 471 | 17.6／25ms | 42ms |
  | 剔除開，步長 1200 | 888 | 17.5／23ms | 43ms |
  | 剔除開 + CSS containment | 888 | 17.2／22ms | 43ms |

  結論：**捲動全部貼著 60Hz 一幀，1,400 個 mark 的 DOM 靜態捲動撐得住**（CLAUDE.md 那句「DOM 撐得住」在這個量級仍成立），剔除只在縮放時有效（少建 2/3 的 DOM）。CSS containment 無差異，不加。保留 `virtualize`、`VIEWPORT_STEP` 改 1200 減少捲動時的重渲染。
  - 縮放仍 >16ms：瓶頸是 8 欄重跑 `placeEvents` + React 調和，不是渲染。要再快得走「縮放中先只動 CSS transform、放手後才重排版」，不在這一輪。
  - 數字是 debug + dev mode 的，release 會更好；相對關係才是重點。
- [ ] Phase 7 同步與打包

## Phase 0 筆記

- **`app/package.json` 刻意不列 react／react-dom／zod／@types/\***：必須跟網站共用根目錄 `node_modules` 的同一份。
  第一版有列，結果 `app/node_modules/zod`（4.5.2）與根目錄（4.4.3）各一份，`../src/lib/schema.ts` 用根的、
  shim 用 app 的，`tsc` 型別互比直接 OOM（4GB）；React 兩份則會在執行期讓 hooks 壞掉。
  `vite.config.ts` 另加 `resolve.dedupe` 保險。**要先在根目錄 `npm install`，再在 `app/` 裝。**
- shim 的換法是 `resolveId` 之後比對絕對路徑，不是字串 alias（`./lib/data` 與 `./data` 兩種寫法都抓得到）。
- 開發期每次啟動都從 YAML 重建上游表（`lib.rs` setup）；YAML 有錯 App 起不來並印原因，跟網站同一個精神。
- 資料庫在 `~/Library/Application Support/tw.kigi.aoe/aoe.sqlite`（Windows 是 `%APPDATA%\tw.kigi.aoe\`）。
- macOS 上 `screencapture` 要給終端機螢幕錄製權限才能自動截圖驗畫面。
- `app/index.html` 曾被根目錄 `.gitignore` 的 `/*/index.html` 擋掉沒進 commit，已加 `!/app/index.html` 例外。
- 自動化測試打字會被中文輸入法吃掉，改用 `pbcopy` + ⌘V 貼上；Esc 會先關對話框（Esc 協定）。
- 字型仍走 Google Fonts（CSP 已放行）；離線退回系統字型。打包前內嵌（Phase 7）。
