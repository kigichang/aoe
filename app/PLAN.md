# AoE 桌面版（Windows／macOS）實作計畫 — Tauri 2

## Context

網站 `aoe` 已累積 8 個主題、2,617 則事件、269 段時期（`src/topics/**`），是唯讀的並排時間軸。
要做桌面 App，**沿用現行網站的畫面與操作、不改動 Web 版的行為**，並新增：

1. 跨主題並列：把不同主題的欄位（`world/china` + `science/physical` + `art/music`）放在同一條軸上。
2. 使用者自行新增事件，一則事件可放到多個主題的欄位上。
3. 事件加多組 Tag（有層級）並建立明確的有向關聯。
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
    editor/                  事件編輯、placement、Tag 編輯（層級）、關聯編輯
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
tags             (id PK, parent_id NULL, name, color)      -- 只有層級，沒有分組
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
  - ~~tag_groups（分組）~~：2026-09-01 移除。分組是扁平的收納、父層是階層，兩層收納對這個量的 tag
    是多的；管理對話框也拿掉「點 tag 在右邊列出事件」那半邊（`events_with_tag` 留著，command 與 `api.ts`
    仍是一對一）。**還沒發布給使用者，所以直接改 migration 004，不另開一支做搬遷**（使用者的決定），
    開發機的 tag 資料清空重來。日後有人裝了就不能再這樣做。
  - 那條「只能往後加」的規則若日後真的要破例做**重建表**的 migration：`rusqlite`（bundled）的
    `foreign_keys` 預設是 **ON**，`DROP TABLE tags` 會經由 `event_tags` 的 `ON DELETE CASCADE`
    把使用者貼過的 tag 安靜地清掉，而 migration 本身還是成功的。要在 `db::open()` 明著關掉 FK、
    跑完再打開（PRAGMA 寫在 migration 的 SQL 裡不生效，那是在 transaction 內）。
  - 2026-09-02 補**工具列搜尋比對 tag**：網站的 `search()` 加一個選填的 `ExtraMatch`（排在鏈的最後、
    權重 0，網站不傳就完全等於現況；實測 bundle +174 bytes，前五道比對的最小化輸出逐字元相同），
    桌面版用 `app/src/tags/useTagIndex.ts` 把 tag 攤平進記憶體再同步比對。走的是新的
    `list_event_tag_names`（整張 event_tags 攤平，不展開子孫）——**`events_with_tag` 仍然沒有前端
    呼叫者**，祖先展開刻意放在前端做，後端展開的話同一個名字會在很多則事件上重複傳一遍。
    索引在搜尋框聚焦時重抓（外加掛載時一次）：貼完 tag 不會立刻生效，點回搜尋框才會。
  - 2026-09-03 補**依 tag 標出事件**：標籤管理的 tag 名稱與詳情面板的 tag chip 都可以點，
    點下去把貼著它（含子 tag）的事件在時間軸上標出來 —— `events_with_tag` 到這裡才終於
    有前端呼叫者。網站的 `<App>` 為此多三個選填 prop（`highlightIds`／`highlightLabel`／
    `onClearHighlight`），不傳完全等於現況；決策記在 CLAUDE.md 的「強調一組事件」。
    - **是強調，不是篩選**：其餘事件照畫，橫向對照才不會斷（同「搜尋是導覽，不是篩選」）。
    - 「不用放大就看得到」靠**墊重要度**（`layout.ts` 的 `highlightImportance`：複製一份、
      importance 設 5）。改的是複本，所以取消強調不必「還原重要度」，只是不再套那一層。
    - 目前 View 裡一則都對不到就不改狀態，跳一個對話框說找不到，並且**一併關掉標籤管理視窗**：
      兩層對話框各自掛在 document 上聽 Esc，`preventDefault` 擋不住同一個節點上的另一個監聽器，
      按一次 Esc 會把兩層一起關掉。
    - 實測（`npm run tauri dev`）：台灣史點標籤管理裡的 `test`（5 則）→ 管理視窗關閉、工具列
      出現「Tag：test」與「取消強調」鈕；切到世界史再點同一個 tag（它那 5 則 ref 全是
      `taiwan/*`）→ 只跳「找不到符合的事件」，強調狀態沒被動到；世界史選 `cn-jiuzi-duodi`
      （importance 3）貼上 tag 後點詳情面板的 chip → 同一格出現。
    - **墊重要度是在全域視角（重要度 5+）驗的**，那是唯一分得出有沒有效的視角：強調中時
      時間軸上有 `1708 九子奪嫡`（ppy 0.14 排不下標籤，退化成圖釘，是既有行為），按 ✕ 之後
      它就不在畫面上了 —— 重要度確實回到 3，複本沒有外洩。**台灣史驗不出這一段**：
      `MIN_PPY ≈ 1.33` 已越過 imp-3 的門檻，縮到最小也看得到 3+，貼不貼 tag 都一樣。
    - 這次是用 macOS 的輔助使用（AX）樹讀元素名稱、按按鈕驗的（終端機沒有「螢幕錄製」權限，
      `screencapture` 拿不到畫面）。**所以驗到的是「元素在不在、狀態對不對」，不是樣式** ——
      `is-selected` 的底色與圖釘外環是另外在網站上用臨時 props 截圖看的。
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
- [x] Phase 7 同步與打包（2026-08-30）：`tools/bundle.mjs`（跟網站共用 Zod schema 與 `validate.ts`）產 `data-bundle.json.gz` + `manifest.json`，deploy.yml 一併部署到 `/data/`；`build.rs` 把同一份 bundle `include_bytes!` 進安裝檔（離線首開即有完整資料）；「資料」面板做完版本顯示／檢查更新／下載套用／孤兒檢查／匯出。App 自身的更新走 `tauri-plugin-updater` + GitHub Releases。字型改成本機內嵌。
  - 實測同步一次：`repo` → `20260830.d51fdba`，user_events=1／event_tags=1／questions=4 全數保留。
  - 實測 `tauri build`（macOS aarch64）：`AoE.app`、`AoE_0.1.0_aarch64.dmg`、`AoE.app.tar.gz`(updater) + `.sig`。

## Phase 7 筆記

### 兩條互不相干的更新線

**歷史資料**換的是 `src/topics` 打包出來的 bundle，**App 版本**換的是程式本身。
補幾則事件遠比改程式頻繁，分開才不必為了新增一則事件重發整包安裝檔 ——
補完資料 push `main`，deploy.yml 重新產生 `/data/`，App 端按「檢查更新」就拿得到。

上游資料的來源有三個，優先序固定：**repo YAML（開發期）→ 內嵌 bundle → 線上下載**。
`AOE_NO_REPO=1` 可以讓 debug 建置也走 bundle 模式（測同步用），
`AOE_SYNC_BASE` 可以把來源指到本機的 `vite preview`。

### reqwest 刻意不開 `gzip` feature

bundle 本身就是 `.gz`。開了 gzip feature 之後 reqwest 會自動解壓，
`bytes()` 拿到的就不是原始檔，manifest 裡的 sha256 **永遠對不上**。
症狀是「manifest 100cae82…，實際 6482743e…」，看起來像檔案在傳輸中壞掉，
很容易往網路那邊查。這條跟 CLAUDE.md 那些「畫面看起來正常，資料其實錯了」是同一類陷阱。

manifest 抓取一律帶 `?t=<now>`：網域走 Cloudflare 有快取，不破快取的話剛部署的版本會有一陣子檢查不到。

### 上游表整批重建，所以孤兒檢查是必要配套

使用者資料指向上游事件的欄位**刻意沒有 FK**（上游會被 DROP 重建）。
代價是同步後可能出現指向不存在 ref 的 tag／關聯／題目／placement，
所以 `orphans()` 不是選配。**孤兒不自動刪** —— `title_snapshot` 讓使用者還讀得懂
那筆原本指的是什麼，要改連結還是刪除是他的決定。上游改了 id 不該連使用者的筆記一起帶走。

### 簽章：三種互不相干的東西

| 簽的是什麼 | 用什麼 | 現況 |
|---|---|---|
| 更新包出自這把私鑰 | 自己的 minisign 金鑰 | 已建立，私鑰在 `~/.aoe/aoe-updater.key`（**不在版控**），公鑰寫在 `tauri.conf.json` |
| Windows：這個 exe 出自某個可信發行者 | 程式碼簽章憑證 | **沒有**，SmartScreen 會擋一次 |
| macOS：Apple 公證過 | Apple Developer ID | **沒有**（使用者的決定：開發期不處理），只做 ad-hoc `signingIdentity: "-"` |

三者互不替代。updater 能運作跟 Apple／Microsoft 的憑證完全無關，這正是開發期
不碰 Apple Developer 也能發 Windows 版並自動更新的原因。

**私鑰遺失就沒辦法再發更新給已安裝的使用者**（公鑰已經寫死在他們的 App 裡）。
CI 用 `TAURI_SIGNING_PRIVATE_KEY`（金鑰內容，不是路徑 —— `..._PATH` 那個環境變數
tauri CLI 認不得，會在 bundle 完成後才報「找不到私鑰」，而且 exit code 還是 0）
與 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 兩個 GitHub secret。

### 字型改成本機內嵌

原本沿用網站的 `<link>` 到 fonts.googleapis.com。桌面版第一次啟動可能完全離線，
退回系統字型會讓 LXGW WenKai TC 的手寫感（軸線刻度與標題用它）不見，
而且是**時有時無** —— 有網路一個樣、沒網路另一個樣，比一律用系統字型更難查。

`npm run fonts`（`tools/fonts.mjs`，predev／prebuild 自動跑）抓 335 個 woff2 子集共約 14MB，
產物 gitignored。**刻意不做 subset**：使用者可以自己新增事件，打什麼字不可預期，
subset 過的字型會出現豆腐字。完整子集靠 unicode-range，WebView 只會載入真的用到的那幾個。
CSP 也因此收緊成 `font-src 'self'`。

### 發布流程

`.github/workflows/app-release.yml`，推 `app-v*` 標籤觸發，出 draft release：

- macOS 一份 universal `.dmg`（分兩個 runner 各出各的也行，但使用者要自己挑架構，不值得）
- Windows NSIS `.exe`，`installMode: currentUser`（不必 UAC；更新時也不會每次跳提權）
- `includeUpdaterJson` 產生 `latest.json`，`tauri.conf.json` 的 endpoint 指到
  `releases/latest/download/latest.json` —— **draft release 不算 latest**，要按下發布才會生效。

CI 要 `npm ci` **兩次**（根目錄 + `app/`）：`app/package.json` 刻意不列 react／zod，
前端靠 vite 的 dedupe 共用根目錄那一份；`build.rs` 產內嵌 bundle 時跑的
`tools/bundle.mjs` 也吃根目錄的 js-yaml 與 zod。

### 同步端點掛在 Cloudflare Pages，不是 GitHub Pages

`dig aoe.kigi.tw` → `aoe-911.pages.dev`：站台早就搬到 **Cloudflare Pages**
（見 repo 的 `CLOUDFLARE.md`），`deploy.yml` 建出來的 GitHub Pages 那份已經不是
線上內容。所以 bundle 一開始加在 deploy.yml 的獨立步驟是**沒有效果的** ——
它只進了那份沒人看的部署。改成綁在 `npm run build` 尾端，因為 Cloudflare 的
建置指令設在後台、repo 管不到，只有 build script 是兩邊共通的那一段。

**Cloudflare Pages 對未知路徑回 200 + index.html，不是 404。** 這讓「檔案沒部署」
偽裝成「檔案壞了」：`sync_check` 只看狀態碼的話，會拿 HTML 去 parse JSON，
訊息是 serde 的「expected value at line 1」。已加一道 content-type／`<` 開頭的檢查。

### Windows 第一次建置就抓到一個「只有 Windows 會壞」的 bug

`app-v0.1.0` 第一次跑 CI，macOS 綠、**Windows 紅**，錯誤訊息是：

```
../src/topics/religion/topic.yaml (1:7): Unexpected character '。'
```

看起來像 YAML 壞了，實際上是 **`vite.config.ts` 的 shim 沒有生效**。
比對用的是解析後的絕對路徑，而 `resolve()` 在 Windows 上給的是
`D:\a\aoe\src\lib\data.ts`（反斜線），Vite／Rollup 的 `id` 一律是正斜線 ——
兩者永遠不相等。於是網站真正的 `data.ts` 被拉進模組圖，它的
`import.meta.glob('../topics/*/*/events.yaml')` 需要 `@rollup/plugin-yaml`
（桌面版刻意沒裝），最後炸在一個看起來毫不相干的地方。

修法是比對前一律 `replace(/\\/g, '/')`。但**真正的教訓是它太安靜** ——
如果桌面版剛好裝了 yaml plugin，這個 build 會成功，只是資料變成從 YAML 來、
不是從 `window.__AOE_DATA__` 來，整個 View 機制默默失效而畫面看起來正常。
這正是 CLAUDE.md 那句「畫面看起來正常，資料其實錯了」。

所以同時加了兩道建置期防護（實測把 `norm` 改成不對稱之後兩道都會擋下來）：

1. **YAML 進到模組圖就 `this.error`** —— 那是這個 bug 的直接症狀。
2. **`buildEnd` 檢查 `data.ts` 的 shim 有沒有真的命中。**

`topic.ts` 那支刻意**不**列入必須命中：它唯一的 importer 就是 `data.ts`，
而那支已經被換掉了，所以現在沒有人 import 它 —— 這也是加了檢查才發現的。

### 乾淨 Windows 機器的驗證交給 CI

手上沒有 Windows 機器，所以「乾淨機器可安裝、離線開啟」這條判準改由
`app-release.yml` 的 `smoke-windows` job 每次發版自動跑：**下載 draft release 裡
的安裝檔 → 靜默安裝 → 啟動 → 檢查資料庫**。GitHub 的 windows runner 本來就是
一台乾淨機器（沒有 repo 的 YAML、沒有前一版的資料庫、不是開發模式）。

實測輸出：

```
DisplayName=AoE  InstallLocation=C:\Users\runneradmin\AppData\Local\AoE
啟動 aoe-app.exe
version=20260830.d46ca7a topics=8 events=3216 periods=282 builtinViews=8
```

**刻意是獨立的 job 並從 release 下載**，不是在 build job 裡就地測：測到的是真的
會發出去的那一個檔，而且兩分鐘跑完、掛掉可以單獨重跑（`skip_build` 這個
dispatch 參數就是為此），不必為了驗證安裝檔付一次十幾分鐘的 Rust release build。
第一版是就地測的，每修一個小問題就要等一輪完整建置。

寫這段時踩到的三個 Windows 細節，都是「猜」出來的失敗長得像另一回事：

| 猜的 | 真的 |
|---|---|
| exe 叫 `AoE.exe`（productName） | `aoe-app.exe`（Cargo 的 crate 名）——productName 只用在顯示名稱與安裝目錄 |
| 登錄檔的 `InstallLocation` 是乾淨路徑 | 值裡**帶著字面上的引號**，不 Trim 會被當成一個叫 `"C` 的磁碟機 |
| 找不到 exe = 安裝失敗 | 兩者症狀一樣；所以現在找不到時會把 HKCU 的 Uninstall 項目全印出來 |

冒煙測試的期望值**刻意不寫死事件數**——每補一批資料就要回來改的檢查遲早會被
改成擺設。改成驗量級（`events >= 1000`）與結構（內建 View 數 == 主題數），
外加 `version` 不可以是 `"repo"`（那代表它讀到 repo 的 YAML，等於什麼都沒測到）。

### updater 端到端實測過（含簽章）

`app-v0.1.0` 發布後，把 `tauri.conf.json` 的 version 暫時改成 `0.0.9` 建一份出來，
對正式端點跑完整條路：檢查 → 「有新版 0.1.0」＋發布說明 → 下載 42MB →
**驗簽章** → 換掉 .app → 重開，`Info.plist` 變成 `0.1.0`，使用者資料原封不動。

**只按「檢查更新」不算驗到簽章** —— 檢查只抓 `latest.json` 比版本號，
簽章是下載完才驗的。所以 pubkey 對不對非得走一次真的更新才知道。

途中撞到一個值得記的限制：**.app 放在外接卷宗（`/Volumes/…`）時更新會失敗**，
訊息是 `Cross-device link (os error 18)` —— updater 把更新解到系統磁碟的暫存目錄，
再 `rename()` 過去，跨檔案系統的 rename 不成立。把 .app 搬到系統磁碟就正常。
這是 tauri-plugin-updater 的行為不是本專案的 bug，但**訊息完全看不出跟磁碟有關**，
使用者回報時要先問一句「App 放在哪個磁碟」。

### 外部連結（出處）要走 opener plugin

詳情面板的「出處」點下去完全沒反應：WebView 沒有分頁也不讓頁面自己開視窗，
`target="_blank"` 在這裡是 no-op，**而且不報錯、console 乾淨** —— 又一個
「畫面看起來正常、功能其實壞了」。同一個症狀還有事件連結、說明裡的儲存庫連結、
回報面板的 issues 與 mailto。

修法：`tauri-plugin-opener` + capability 加 `opener:default`
（它自帶的 scope 只放行 `http`／`https`／`mailto`／`tel`），前端 `src/externalLinks.ts`
在 document 冒泡階段攔跨來源的 `<a>`，改呼叫 `openUrl()`。

兩個容易踩到的點記在那支檔案裡：**判準是跨來源不是 `target="_blank"`**
（`a.href` 會把主題切換器的相對路徑解析成絕對網址，只看協定會把站內導覽也丟出去），
以及 **plugin 自己就注入了一段功能重疊的 init script**（只攔有 `target` 的、
且跳過 cmd／alt 點擊），我們掛得比它早、攔到就 `preventDefault()`，所以不會開兩次。

### 還沒做

- **Windows 上的線上同步與 App 更新**還沒實測（macOS 兩者都對正式端點驗過）。
  冒煙測試只驗到內嵌 bundle 那條路。
- Windows 程式碼簽章憑證（公開發布前要嘛買、要嘛接受 SmartScreen 警告）。
- macOS 公證（使用者決定開發期不處理）。

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
- ~~字型仍走 Google Fonts~~：Phase 7 已改成本機內嵌，CSP 收緊成 `font-src 'self'`。
