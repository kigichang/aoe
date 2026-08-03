---
name: enrich-history
description: >-
  Reads one or more Wikipedia article URLs and uses them to add or enrich
  events in this project's src/topics/*/*/events.yaml data files. Use this
  whenever the user gives Wikipedia link(s) and asks to "補充<地區>史"
  (supplement X history), asks to sort events into two regions by where they
  happened, or asks to "反覆整理 5 次，並列出每一次整理出來的事件" (iterate
  5 times and list what each pass found). Also use for batch/repeated data
  entry sessions reading several related articles in a row (e.g. a dynasty's
  main article plus its founding/succession-state articles). Not for general
  Wikipedia research unrelated to this project's timeline data.
---

# 補史料：讀維基、比對現有資料、驗證出處、寫入 events.yaml

這個 skill 把整個對話裡重複做的動作固定下來：使用者丟一個或多個維基百科
連結，要求補充某個地區（或依「發生地」拆成兩個地區）的歷史事件，通常伴隨
「反覆整理 5 次，並列出每一次整理出來的事件」。

**核心心法：新讀到的東西，十之八九已經在資料裡了或已經被某一則的 desc
帶過——這個 skill 的價值不是「多找事件」，是「先弄清楚真正的缺口在哪」。**
常犯的錯誤是每次都硬湊出一串新條目；及格線是誠實回報「這次沒有新缺口，
只豐富了描述」，那也是完整且有價值的結果。

不要重寫 `CLAUDE.md`／`README.md` 已經講清楚的欄位規則（`year`／`endYear`／
`category`／`importance`／`desc`／`sources` 的格式，`legendary` 旗標，
授權界線）——**先讀那兩份文件**，這裡只補流程。

## 前置：確定範圍

1. 從使用者的指示判斷目標地區/欄位（`src/topics/<主題>/<地區id>/events.yaml`）。
   世界史主題（`src/topics/world/`）目前有 `taiwan`／`japan`／`china`／`europe`
   四欄，`id` 前綴依序是 `tw-`／`jp-`／`cn-`／`eu-`（前綴取自 `regions.yaml`
   裡的 `id`，別靠記憶硬編，新主題要重新確認）。
2. 若使用者給了分流規則（例如「發生地在台灣歸台灣史，其他歸中國史」），
   照規則分派，同一次任務可能同時寫兩個 `events.yaml`。
3. 若只講「補充X史」沒提「反覆整理 5 次」，流程照跑，但收尾報告可以簡短
   （不必逐輪列清單），對照本次對話後段幾個單篇任務的作法。

## 五輪流程

### 第一輪：廣泛擷取

用 `WebFetch` 讀目標網址，prompt 要求「完整列出所有具體歷史事件，包含年份、
事件名稱、簡短描述」，並在 prompt 裡提示這篇條目特別該注意的子主題
（背景、關鍵戰役/條約、制度、文化、後續影響……）——這決定擷取的深度，
籠統的 prompt 只會拿到目錄等級的摘要。

### 第二輪：比對現有資料，抓真正的缺口

**這一輪最容易被跳過，也最重要。** 對每個候選事件，先查現有資料：

```bash
grep -n "^- id: cn-xxx" -A10 src/topics/world/china/events.yaml   # 看單一事件全文
grep -n "^- id:|^  year:|^  title:" src/topics/world/china/events.yaml | paste - - -   # 列出某個朝代/時期區段的 id/year/title 一覽
```

三種情況，處理方式不同：

- **完全沒提到** → 真缺口，列入候選。
- **標題已存在，但那則事件完全沒有 `desc`，或 `desc` 只有一句籠統帶過**
  （例如只寫年代與朝代名，沒寫任何細節）→ 不開新條目，**豐富既有描述**。
  這個對話裡至少三次發現「以為要新增，一查現有 desc 早就用一句話帶過了」。
- **已經被相鄰事件的 `desc` 順帶提及**（例如甲事件的 desc 寫「隔年乙條約
  簽訂」）→ 視乙事件本身的分量決定：分量夠重（例如岳飛之死、鄭成功北伐）
  仍值得獨立成則把故事講完整；分量普通就不必疊床架屋。

### 第三輪：抓精確年代、判斷取捨

- 對日期不確定或籠統的候選，可以再做一次更窄的 `WebFetch`（縮小 prompt
  範圍到那幾個主題），或依可靠的既定史實直接採用——不必每個日期都能在
  單次 fetch 裡問到，但要能講出可信來源。
- **篩掉的判準**：
  - 重複性的政治表態／聲明（例如同一爭議在數十年間被反覆重申，不是
    各自獨立、發生在特定地點的事件）→ 不逐條收錄。
  - 過度瑣碎的行政程序細節（會議次數、人事任命的中間步驟）→ 不獨立成則，
    最多併入其他事件的 `desc`。
  - 找不到乾淨的單一事件年份、硬湊會製造假精度（例如某制度是漸進形成，
    沒有明確頒行日）→ 放棄，不要編一個日期出來。
  - 消歧義頁／泛稱概念條目撐不起要引用的具體宣稱 → 換更精確的條目，
    找不到就放棄這則候選，不用弱來源硬湊（CLAUDE.md「陷阱二」）。
- **同一史實兩地區各自收錄是有先例的**：鄭成功攻台（台灣史／中國史各一則、
  各自的框取角度）、中日建交／台日斷交、SARS 疫情（台灣的醫院封院／
  中國的疫情起源）。判準是兩地區的敘事真的需要各自的因果脈絡，不是機械
  地把每個跨地區事件都複製兩份。

### 第四輪：維基 API 批次驗證出處

**寫入前，每一個候選來源標題都要先驗證存在、沒有被重新導向到消歧義頁。**

```bash
curl -s -m 20 -G "https://zh.wikipedia.org/w/api.php" \
  --data-urlencode "action=query" \
  --data-urlencode "format=json" \
  --data-urlencode "redirects=1" \
  --data-urlencode "converttitles=zh-hans" \
  --data-urlencode "prop=pageprops" \
  --data-urlencode "ppprop=disambiguation" \
  --data-urlencode "titles=標題A|標題B|標題C"
```

日文／英文維基換 host（`ja.wikipedia.org`／`en.wikipedia.org`），
`converttitles=zh-hans` 只有查中文維基時需要（繁簡誤報 missing 的解法）。

看回應裡的三件事：

- `missing` → 條目不存在，換標題再查一次。
- `redirects` → 通常沒問題（繁簡轉換、同義詞），但**換了詞的**要停下來看
  是否真的指向同一件事（CLAUDE.md「陷阱二」的表格）。
- `pageprops.disambiguation` → 消歧義頁，不能直接用。用
  `action=parse&page=<條目>&prop=links` 把消歧義頁的候選連結叫出來，
  挑正確的那個再驗一次。

**不要跳過這輪去猜標題。** 這個對話裡靠這一步抓到的問題：「清黨」是
消歧義頁（改用「四一二事件」）、「己巳之變」是消歧義頁（解析後找到
「己巳之變 (崇禎)」）、「南巡講話」條目不存在（改用「鄧小平南巡」）、
「中國加入世界貿易組織」找不到專門條目（改引泛稱條目「世界貿易組織」，
但這是判斷過的例外，不是預設做法）。

### 第五輪：定稿寫入

1. 決定 `id`（`<地區前綴>-<英文kebab-slug>`，全域唯一）、`year`／`endYear`、
   `category`（六類之一，或查該主題的 `categories.yaml`）、`importance`
   （比照鄰近既有事件的量級校準，不要每個新事件都給 5）。
2. `desc` 自行撰寫，不要照抄或改寫維基條目文字（CC BY-SA 的 ShareAlike
   界線，README「出處與授權的界線」一節）。年代與事實本身可以自由使用。
3. `sources` 用第四輪驗證過的標題與網址，`title` 格式固定
   `維基百科：<條目原文標題>` 或 `日文維基百科：<條目原文標題>`。
4. 用 `grep -n "^- id: cn-鄰近事件"` 找插入點，**依年份塞進正確的時序位置**，
   不要全部丟在檔案尾端。

### 驗證（每次寫入後一定要跑）

```bash
npm run lint:data -- --check-pages   # 出處覆蓋率 + 維基 API 批次複查一次
npm run check                        # tsc 型別檢查
```

兩個都要乾淨。`lint:data` 失敗代表 schema 錯誤、時期重疊或超出時間軸範圍
（`assertNoOverlap`／`assertInRange` 會直接指出是哪個檔案哪一筆）；
`--check-pages` 失敗代表有出處標題沒驗證過就寫進去了，回到第四輪修正。

## 回報格式

若使用者要求「反覆整理 5 次」，逐輪列出：

- 第一輪擷取到幾則候選、涵蓋範圍
- 第二輪比對後篩掉了哪些（已收錄／已在描述裡帶過）
- 第三輪的取捨判斷（為什麼某幾類候選被排除）
- 第四輪抓到的來源問題與怎麼修正
- 第五輪最終寫入的事件清單，按地區分組列出（標題＋年份＋一句話說明為什麼重要）

沒有要求「5 次」時，直接做完整流程，但收尾用一段精簡摘要即可，不必逐輪
複述——參考本次對話後段幾個單篇任務（如補〈文禄・慶長の役〉只豐富了一則
既有事件、補〈中日和約〉判定沒有新缺口）的報告方式。

## 自動 commit

寫完資料、跑完驗證後停下來，自動 commit。
（一個來源一個 commit，訊息用 `data(<地區>): 補充…` 的格式，可參考
`git log --oneline` 裡近期的 `data(china)`／`data(taiwan)`／`data(japan)`
commit）。
