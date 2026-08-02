# AoE

把不同地區的歷史放在同一條時間軸上並排比較 —— 秦統一中國的那一年，羅馬正在打第一次布匿戰爭。

目前收錄台灣史、日本史、中國史、歐洲史共 518 則事件，時間範圍西元前 3000 年至
西元 2026 年（見 `src/topics/world/timeline.yaml`）。全部事件皆附維基百科出處（750 條連結，中/日/英三個站台，均已驗證可連）。

站上還有另一個主題「台灣鐵道史」（`/tw-railway/`），目前是驗證多主題機制用的種子資料。

## 開發

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 型別檢查 + 打包到 dist/
npm run check    # 只跑型別檢查
```

## 部署到 GitHub Pages

推到 `main` 就會經由 `.github/workflows/deploy.yml` 自動部署。第一次要先到
**Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。

`vite.config.ts` 會從 `GITHUB_REPOSITORY` 自動推出 `base`，所以專案頁面
（`<user>.github.io/<repo>/`）不需要手動改設定。

## 主題

一個**主題**是一份獨立的資料集加上一個網址。世界史掛在根網址，其餘掛在
`/<目錄名>/`：

```
https://kigichang.github.io/aoe/              → src/topics/world/
https://kigichang.github.io/aoe/tw-railway/   → src/topics/tw-railway/
```

```
src/topics/<主題>/
  topic.yaml         主題設定（見下）
  regions.yaml       欄位定義
  timeline.yaml      時間軸上下界
  categories.yaml    類別（選填，沒有就用預設六類）
  <欄位id>/
    events.yaml
    periods.yaml
```

### `topic.yaml`

```yaml
name: 台灣鐵道史                  # 標題列的 h1
title: 台灣鐵道史 — 並排比較…      # 選填，瀏覽器分頁標題。沒填就用 name
description: 把台灣各家鐵道…      # 標題列副標，同時是 HTML 的 meta description
columnLabel: 營運者               # 選填，欄位在這個主題叫什麼。預設「地區」
defaultPpy: 12                   # 選填，開場縮放（px/年）。沒填取「整條軸約兩屏」
jumps: [1890, 1910, 1930]        # 選填，年代跳轉按鈕。沒填依範圍自動產生
root: true                       # 掛在根網址。**恰好一個主題可以設**
```

`root: true` 是「哪個主題掛在根網址」的唯一來源，`vite.config.ts` 與 `data.ts`
都讀它。沒設或設兩個都會在建置期與載入期直接報錯。

`defaultPpy` 是**密度問題的主要槓桿**：覺得畫面上圖釘太多、讀得到的標題太少時
要調的是它，不是類別門檻，也不是資料的 `importance`（CLAUDE.md 有實測數據）。

### 新增一個主題

1. 建 `src/topics/<目錄名>/`，放 `topic.yaml`、`regions.yaml`、`timeline.yaml`
2. 每個欄位建一個子目錄，放 `events.yaml`（與選填的 `periods.yaml`）
3. 需要自己的類別就加 `categories.yaml`

**不用改任何程式碼**，資料是用 `import.meta.glob` 掃進來的，HTML entry 由
`vite.config.ts` 依 `topic.yaml` 產生（`/<目錄名>/index.html`，gitignored）。
GitHub Pages 沒有 server-side rewrite，所以那份實體檔案是必要的 ——
靠前端 router 接不到子路徑。

### `categories.yaml`

沒有這個檔就沿用預設六類（政治／戰爭／文化／科技／宗教／經濟）。

```yaml
- id: opening
  label: 通車
  glyph: 通      # 圖釘上那一個字，限一個字元
```

**最多六個**，而且 `glyph` 只能一個字 —— 類別的識別完全靠這個漢字，不靠顏色
（顏色只承載欄位）。理由與量測結果見 CLAUDE.md。

## 新增資料

### 事件

編輯 `src/topics/<主題>/<欄位>/events.yaml`：

```yaml
- id: cn-qin-unification    # 全域唯一
  year: -221                # 負數 = 西元前。沒有西元 0 年
  endYear: -206             # 選填，有跨度的事件才給
  title: 秦滅六國，統一中國
  category: politics        # politics|war|culture|science|religion|economy
  importance: 5             # 1-5，見下
  desc: 廢封建、行郡縣…      # 選填，顯示在詳情面板
  sources:                  # 選填，這筆資料的依據，供讀者查證
    - title: 維基百科：秦滅六國之戰
      url: https://zh.wikipedia.org/wiki/秦滅六國之戰   # 選填（書籍沒有網址）
  links:                    # 選填，延伸閱讀。與 sources 語意不同，UI 也分開呈現
    專題報導: https://...
  # legendary: true         # 選填，年代出自後世追記時才給。見下
```

### `legendary`：傳說事件

三皇五帝、神武天皇、羅馬建城這類**年代出自後世追記、而非考古定年**的事件，
加上 `legendary: true`。畫面上會改成虛線圈 + 斜體年份 + 較淡的標題，工具列
也有一顆「傳說」chip 可以整組開關。

**`category` 照事蹟性質照常給**，不要因為是傳說就改動 —— 伏羲畫八卦仍是
`culture`、黃帝敗蚩尤仍是 `war`、大禹治水仍是 `economy`。`category` 說的是
「這是哪一種事」，`legendary` 說的是「這件事有多確定」，兩者互不干涉。
同理 `importance` 也照常給。

### 出處與授權的界線

**`sources` 是給讀者查證用的指標，不是「可以照抄」的許可。**

| 內容 | 能不能用 | 條件 |
|---|---|---|
| 年代、人名、地名、事件本身 | 可以自由使用 | 事實不受著作權保護 |
| 維基百科的條目**文字** | 要守 CC BY-SA | 署名 + 標示授權 + **相同方式分享** |

關鍵是 ShareAlike：只要 `desc` 抄了或近似改寫維基的句子，整批資料就得跟著改採
CC BY-SA。所以本專案的做法是 **查維基確認年代，`title` 與 `desc` 一律自行撰寫**，
如此完全不觸發 ShareAlike。若日後真要引用條目文字，請放在明確標示的獨立欄位，
並將 `src/topics/` 與 MIT 的程式碼分開授權。

網址請用 `/wiki/<條目名>`，不要用 `/zh-tw/` —— 後者是繁簡變體路徑，前者才是正規網址。
標題裡的空白寫成底線。

### 出處可以引用哪些維基站台

不限中文維基：**日本史可引日文版、歐洲史可引英文版**，那是該主題的母語社群，
條目通常完整得多（`堂島米會所` 中文版 1.3KB、日文版 23KB）。

- 中文版夠用就用中文版，讀者查證最方便；母語版是拿來補不足的，不是預設。
- 中文版不存在或明顯單薄時，額外掛上母語版，不必刪掉中文版那筆。
- **`title` 一律寫繁體中文並標明語言**，讓讀者點之前就知道會看到什麼語言：

```yaml
  sources:
    - title: 維基百科：堂島米會所
      url: https://zh.wikipedia.org/wiki/堂島米會所
    - title: 日文維基百科：堂島米會所
      url: https://ja.wikipedia.org/wiki/堂島米会所
```

### 檢查資料

```bash
npm run lint:data                  # 列出重要度 >= 4 卻沒有出處的事件
npm run lint:data -- --min 3       # 調整門檻
npm run lint:data -- --topic world # 只檢查單一主題（預設全部）
npm run lint:data -- --check-urls  # 連線驗證每個出處網址是否還活著
npm run lint:data -- --check-pages # 問維基 API：條目是否存在、是不是消歧義頁
npm run lint:data -- --strict      # 有缺漏就 exit 1，可用於 CI
```

刻意沒有接進 `npm run build`：缺出處不該擋掉建置，但補資料時需要一份待辦清單。
兩個檢查都值得定期跑，抓的是不同的東西：

- `--check-urls` 驗狀態碼。條目會被改名，實測第一批 61 個網址就有 4 個是錯的。
- `--check-pages` 驗「連得通但指錯地方」。消歧義頁一樣回 200，`--check-urls`
  永遠抓不到 —— 實測掃出 3 個躺了很久的消歧義頁（`米蘭敕令`、`君士坦丁一世`、
  `聖像破壞運動`，三個名字在中文維基都不只一個對象）。

**`importance` 要認真給。** 它決定事件在哪個縮放層級才出現：全域視角只顯示 5，
放大後才逐層釋出 4、3、2、1。全部都給 5 的話，五千年的事件會擠成一團誰也讀不到。
大致標準：

| 級 | 意思 | 例 |
|---|---|---|
| 5 | 改變了此後數百年的走向 | 秦統一、羅馬帝國建立、工業革命 |
| 4 | 一個時代的關鍵轉折 | 安史之亂、黑死病 |
| 3 | 值得一提的事件 | 王安石變法、圖爾戰役 |
| 1-2 | 細節，只在高倍率下出現 | — |

### 時期（朝代）

編輯 `src/topics/<主題>/<欄位>/periods.yaml`。時期畫成欄位左側的背景色帶，
**同一條 `track` 上不可以重疊** —— 重疊時載入階段就會直接報錯。

歐洲不是單一政體，所以拆成兩條 track：`0` 是希臘／拜占庭一線，`1` 是羅馬／西歐一線。

### 時間軸的上下界

`src/topics/<主題>/timeline.yaml`：

```yaml
minYear: -3000
maxYear: 2026
```

**事件與時期都必須落在這個範圍內**，否則載入階段直接報錯，訊息會指出是哪個檔案的
哪一筆。這道防護（`data.ts` 的 `assertInRange`）不是龜毛 —— 範圍外的資料會被算成
負的 y 座標畫到畫布外面，**不報錯、主控台乾淨、欄位的「N 則」還照算**，只是你永遠
看不到它。要收更早或更晚的事件，先把這裡的上下界調開。

範圍是設定值而不是從資料推導，因為一則離群的資料就會把整條軸拉長、其餘全被擠扁。
代價是 `maxYear` 會逐年過期，加了超出的事件時防護會直接吼你。

### 新增欄位（地區／營運者／…）

1. 在 `src/topics/<主題>/regions.yaml` 加一筆（`order` 決定由左至右的順序）
2. 建 `src/topics/<主題>/<id>/periods.yaml` 與 `events.yaml`

資料是用 `import.meta.glob` 掃進來的，不用改任何程式碼。

## 搜尋

<kbd>⌘K</kbd> 或 <kbd>/</kbd> 聚焦搜尋框，↑↓ 選擇、Enter 跳轉、Esc 關閉。
可以找標題、描述、年份、欄位名稱與類別。

**搜尋不篩選時間軸**，只是跳過去 —— 橫向對照需要各區的事件都留在原位。
若目標在目前倍率下看不到（重要度太低、欄位或類別被關掉、傳說被關掉），
會自動補上必要的設定並放大到剛好看得見。

## 詳情面板

點事件後，詳情停靠在右側，畫布跟著變窄而不是被蓋住。窄螢幕改成貼底的抽屜。

## 分享連結

網址會跟著目前的檢視走，複製網址列就能分享：

```
https://kigichang.github.io/aoe/#y=-221&z=2&e=cn-qin-unification
                                   \____/ \__/ \__________________/
                                    年份  縮放      選中的事件
```

`y` 是視窗高度 40% 處對應的年份，`z` 是 px/年。三個參數都可以省略。
篩選狀態刻意不放進網址 —— 分享時對方應該看到完整的四個地區。

## 站上的說明

標題列的「？說明」會開啟一層覆蓋式說明：操作方式，以及九種視覺約定的圖例
（類別漢字、地區顏色、實線／虛線、引線、只有圓點、區間線、時期色帶、重要度、時間游標）。

圖例裡的範例是用真正的 CSS class 畫的，所以改了樣式說明會跟著變。
但**說明文字不會自動同步** —— 改動縮放分層門檻、位移上限或 `legendary`
的視覺時，記得回頭看 `src/components/HelpOverlay.tsx`。

資料的填寫規則刻意只放連結回到這份 README，不在站上重寫一份。

## 設計上的幾個決定

**顏色只承載「地區」。** 事件類別用漢字圖釘（政／戰／文／科／教／經）識別，不用顏色。
六個類別散佈在畫布上屬於「任意兩色都可能相鄰」的情境，這種情況下沒有任何六色配色
能同時通過色盲安全距離；漢字是更強的識別通道，而且不需要對照圖例。

**時間刻度是線性的。** 用縮放（`pxPerYear`）處理「古代稀疏、近代密集」，
而不是用非線性刻度 —— 非線性會讓「同時期」這個核心比較失去直覺。

**標籤的位移有嚴格上限。** 時間相近的事件標籤會互相推擠，但位移一旦累積，
就會把事件推到比它更晚的事件下方，讀出來的年代順序就是錯的。所以：
先往旁邊多開一欄標籤（`MAX_LANES`），真的塞不下就退化成只畫圖釘
（放大即可讀），位移絕不超過 `MAX_SHIFT`。被推開的標籤一律用引線指回真實年份。

## 資料來源與授權

程式碼採 MIT（見 `LICENSE`）。

事件資料由 Claude（Anthropic）在與維護者的對話中逐筆整理：擬出候選事件後，
先用維基百科 API 批次查證條目與年代，確認無誤才寫入 YAML；`title` 與 `desc`
一律另行撰寫，未取用條目文字。流程與踩過的坑記在 `CLAUDE.md`。

所以它**不是**從資料庫大量匯入的，也不是逐字手打的。若日後要大量匯入，
建議走 Wikidata SPARQL —— 授權是 CC0，可以直接使用。注意維基百科的
**條目文字是 CC BY-SA**，若採用其敘述需標示出處與授權；純粹的日期與事實
本身不受著作權保護。
