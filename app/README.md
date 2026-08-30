# AoE 桌面版

網站（`../src`）的 React 程式碼原封不動拿來用，外面包一層 Tauri 2。
**為什麼這樣做、每個 Phase 的實測結果與踩過的坑，看 [`PLAN.md`](PLAN.md)。**
這份只講怎麼跑起來、怎麼測。

## 準備（只做一次）

```bash
cd ..   && npm install     # 先根目錄
cd app  && npm install     # 再 app/
```

**順序不能反。** `app/package.json` 刻意不列 react／react-dom／zod：
兩份 React 會讓 hooks 壞掉，兩份 Zod 會讓 `tsc` 型別互比吃掉 4GB 記憶體。
前端靠 `vite.config.ts` 的 `dedupe` 共用根目錄那一份。

還需要 [Rust 工具鏈](https://rustup.rs)。字型（約 14MB）由 `predev`／`prebuild`
自動抓，不必手動跑。

## 開發模式

```bash
cd app && npm run tauri dev
```

**一定要在 `app/` 底下跑**，在 repo 根目錄會是「could not determine executable to run」。

開發模式**每次啟動都從 `../src/topics/**` 的 YAML 重建上游表**，所以改完資料重開
就看得到。YAML 有錯 App 會起不來並在終端機印出原因 —— 跟網站「載入期整片白配一則
明確訊息」是同一個精神，不要當成當機。

## 打包

```bash
cd app
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.aoe/aoe-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
npx tauri build
```

產物在 `src-tauri/target/release/bundle/`。

**不帶簽章金鑰也建得出來**，但會在最後印一行紅字然後不產生 `.sig`——
而且 **exit code 仍然是 0**。要發布的話一定要確認 `.sig` 在。
`TAURI_SIGNING_PRIVATE_KEY_PATH` 那個環境變數 tauri CLI **認不得**，要餵內容。

打包版不讀 repo 的 YAML，資料來自安裝檔內嵌的 bundle（`src-tauri/data/`，
由 `build.rs` 呼叫 `../../tools/bundle.mjs` 產生）。

## 開發用的開關

| 環境變數 | 作用 |
|---|---|
| `AOE_NO_REPO=1` | 即使是 debug 建置也走 bundle 模式，用來測「發布版」的行為 |
| `AOE_TOPICS_DIR=…` | 指定另一份 `topics` 目錄 |
| `AOE_SYNC_BASE=…` | 同步來源，預設 `https://aoe.kigi.tw/data`；指到 `npm run preview` 的位址就能測同步 |
| `AOE_START_QUERY=…` | 一開窗就載入指定的 View，例如 `view=v-perf&perf=1#y=1600&z=4` |

| 網址參數 | 作用 |
|---|---|
| `?view=<id>` | 載入某個 View（切換 View 就是整頁重載，見 PLAN.md） |
| `?perf=1` | 自動跑一次效能基準，結果印在 `tauri dev` 的終端機 |
| `?virt=0` | 關掉視窗剔除，給效能基準做對照 |

## 資料庫

```
macOS    ~/Library/Application Support/tw.kigi.aoe/aoe.sqlite
Windows  %APPDATA%\tw.kigi.aoe\aoe.sqlite
```

**要模擬「乾淨機器第一次啟動」就把它刪掉**（`aoe.sqlite*` 三個檔一起），
下次啟動會從內嵌 bundle 重建。有自訂事件／題目的話記得先備份 ——
整個 sqlite 檔就是備份。

看內容：

```bash
sqlite3 ~/Library/Application\ Support/tw.kigi.aoe/aoe.sqlite \
  "SELECT version FROM bundle_meta; SELECT COUNT(*) FROM events, user_events, questions;"
```

或用跟 CI 冒煙測試同一支腳本：

```bash
node tools/smoke-check.mjs ~/Library/Application\ Support/tw.kigi.aoe/aoe.sqlite
```

## 手動測試清單

一輪走完大概十分鐘。標「★」的是最容易在改動後壞掉的。

**基本畫面**
1. 開起來就是台灣史四欄，捲動、`+`／`−` 縮放、點事件開詳情面板。
2. ★ 同一個 y 座標跨欄是同一年 —— 這是全站唯一的承諾，任何排版改動後都要看一眼。

**跨主題 View**（標題列「組合視圖」）
3. 新建一個 View，挑 `world/china` + `science/physical` + `art/music`，範圍 1500–2026。
4. 三欄各自的時期色帶都在；類別 chip 帶主題後綴（「發現・世界科學史」）。
5. 欄位副標會寫「另有 N 則不在此範圍」——範圍外的事件不進畫面但要算得出來。

**自訂事件**（「＋ 事件」）
6. 新增一則，同時放到台灣史／台灣欄與世界史／中國欄，兩邊都畫得出來、搜尋也找得到。
7. ★ 「資料」→「匯出自訂事件」，檔案格式要跟 `src/topics` 的 events.yaml 一樣。

**Tag 與關聯**（「標籤」）
8. 對兩則事件貼同一個 tag，用標籤面板列出它們。
9. 建一條有向關聯，到目標事件那邊看得到反向的那筆，點了會跳過去。

**題庫**（「題庫」）
10. 出一題單選、故意答錯，確認它進了錯題本。
11. ★ 匯入一份 CSV，一筆有錯的話**整批都不該寫進去**。

**資料同步**（「資料」）
12. 開發模式下這一區會寫「開發模式：直接讀 repo 的 YAML，不做線上同步」。
13. 打包版按「檢查更新」→「下載並套用」，版本要變，而**自訂事件／Tag／題目一則都不能少**。

**App 更新**
14. 按「檢查 App 更新」只會抓 `latest.json` 比版本號，**驗不到簽章**。
    要驗簽章得走一次真的更新（把 `tauri.conf.json` 的 version 暫時降到 `0.0.9`
    建一份出來，做完記得還原）。
15. ★ **.app 不要放在外接卷宗**測更新，會以 `Cross-device link (os error 18)` 失敗，
    而訊息完全看不出跟磁碟有關。

Windows 的「乾淨機器安裝並啟動」由 CI 的 `smoke-windows` job 代跑。
要單獨重跑它（不重建整包）：

```bash
gh workflow run app-release.yml --ref app -f tag=app-v0.1.0 -f skip_build=true
```
