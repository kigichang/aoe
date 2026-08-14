# 搬到 Cloudflare Pages

把站台從 GitHub Pages 搬到 Cloudflare Pages 免費方案的評估與執行步驟，
網域維持 `aoe.kigi.tw`。

**這份是搬遷用的一次性文件。** 搬完並過了觀察期之後，把「收尾」那節做完，
這份文件就可以刪掉（該留的規則會併回 README 與 CLAUDE.md）。

---

## 結論

**可行，而且程式碼一行都不必改。** 三個理由：

**1. `base` 已經是 `/`，換平台不受影響。**
`vite.config.ts` 的推導是：

```ts
const hasCustomDomain = existsSync(join(root, 'public', 'CNAME'))
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = !hasCustomDomain && process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : '/'
```

`public/CNAME` 存在 → 第一個條件就短路，後面的 `GITHUB_ACTIONS` 根本不會讀到。
Cloudflare 的建置環境不會設那兩個 GitHub 的環境變數，但因為短路在前，
結果一樣是 `'/'`。**這是為什麼並存期完全不用碰建置設定。**

**2. 不需要 `_redirects`，也不需要 SPA fallback。**
每個非 root 主題在建置時都會產生實體的 `<slug>/index.html`
（`art`／`religion`／`science`／`tw-railway`），Cloudflare Pages 的靜態服務
本來就會把 `/art/` 對到 `/art/index.html`。頁內狀態全在 hash
（`urlState.ts` 的 `#y=…&z=…&e=…`），沒有任何路徑需要 server 端 rewrite。

主題是從路徑推出來的（`topic.ts` 的 `slugFromPath`），而那個函式對
`/art`、`/art/`、`/art/index.html` 三種寫法都成立，所以自動補尾斜線的
導向也不會出問題。

**3. 規模遠低於免費上限。** `dist` 約 1.3MB、10 個檔案。

---

## 為什麼是 Pages，不是 Workers

Cloudflare 現在主推 Workers static assets，但這個站用不了，理由是硬限制：

> **Workers 的自訂網域要求該 zone 必須在你的 Cloudflare 帳號底下。
> Pages 是唯一支援「zone 不在 Cloudflare 的子網域」的產品** —— 靠一筆
> 指向 `<project>.pages.dev` 的外部 CNAME。

而 `kigi.tw` 不在 Cloudflare。NS 是 `ns1.cyberdns.tw` / `ns2.cyberdns.tw`。

所以：**選 Pages。** 日後若整個 zone 真的搬進 Cloudflare，再回頭評估要不要換
Workers；在那之前這不是一個選項。

---

## `kigi.tw` 的完整 zone

以 cyberdns 主機檔案設定面板為準，並向 `ns1.cyberdns.tw` 逐筆驗證過。
**這 15 筆就是全部** —— 隨機名稱查詢回 NXDOMAIN，沒有 wildcard；
apex、`_dmarc`、`google._domainkey` 的 TXT 全空。

| # | 主機 | 類型 | 值 | 用途 |
|---|---|---|---|---|
| 1 | `gs` | A | `72.14.207.99` | Google（寫死 IP，見下） |
| 2 | `ghs` | A | `74.125.47.121` | Google（寫死 IP，見下） |
| 3–6 | （apex） | A ×4 | `185.199.108–111.153` | GitHub Pages |
| 7 | `blog` | CNAME | `ghs.google.com.` | Google |
| 8 | `otaku` | CNAME | `ghs.google.com.` | Google |
| 9 | `mail` | CNAME | `ghs.google.com.` | Google |
| 10 | `calendar` | CNAME | `ghs.google.com.` | Google |
| 11 | **`aoe`** | CNAME | `kigichang.github.io.` | **本站，要改的就這一筆** |
| 12 | `gaia` | CNAME | `kigichang.github.io.` | 另一個 GitHub Pages 站 |
| 13–15 | （apex） | MX ×3 | `aspmx.l` / `alt1.aspmx.l` / `alt2.aspmx.l.google.com.` | Google Workspace 收信 |

三個從這份清單讀出來、會影響決策的事實：

**`aoe` 與 `gaia` 指向同一個 CNAME 目標，但彼此沒有耦合。**
GitHub 是靠各 repo 自己的 `CNAME` 檔分辨要服務哪個站，不是靠 DNS。
所以改 `aoe` 這一筆**完全不會動到 `gaia`**。

**`gs` 與 `ghs` 是寫死的 Google IP。** 這是很舊的 Google Apps 設定方式
（現在都用 CNAME 指 `ghs.google.com`）。不確定還有沒有在用，但
**搬遷時一律照抄，不要順手「修正」成 CNAME** —— 那是另一件事，跟這次無關。

**目前完全沒有 SPF／DKIM／DMARC。** 這是既有的 email 設定缺口，
不是這次搬遷造成的，也不會被這次搬遷影響（A 案根本不碰 MX）。
但如果哪天真的走 B 案，那會是順手補上的好時機。

---

## DNS 兩案

### A（建議）：NS 留在 cyberdns，只改 `aoe` 一筆 CNAME

把第 11 筆的值從 `kigichang.github.io.` 改成 `<project>.pages.dev.`，
其餘 14 筆一個字都不動。

- **這是這份 zone 裡唯一需要動的一格。** MX、`gaia`、四筆 `ghs.google.com`、
  apex、`gs`／`ghs` 全部不碰 —— 不碰就不會壞。
- 流量仍然走 Cloudflare 邊緣，CDN 與自動 HTTPS 都有。
- 沒有的是 zone 層級的功能（Page Rules、WAF、zone analytics）—— 這個站用不到。
- 限制：**這個作法只適用子網域。** apex（`kigi.tw`）要上 Pages 一定得走 B 案。
- **順序不能顛倒：先在 Pages 後台加自訂網域，再去 cyberdns 改這一格。**
  反過來做（先讓 DNS 指過去、再去後台登記）會拿到 522。

### B：整個 `kigi.tw` 搬到 Cloudflare NS

拿到完整 zone 之後，B 案沒有原先想的那麼危險 —— **15 筆全部已知，
沒有 wildcard、沒有查不到的冷門子網域**，就是 15 列逐筆謄過去而已。
所以否決 B 案的理由不是「不知道裡面有什麼」，而是下面這件事。

**成本全在 email，收益卻與這次搬遷無關。**

- MX 三筆謄錯 = Google Workspace 收不到信。這是全案最嚴重的失敗模式，
  而且不會立刻被發現（寄件人收到的退信不會通知你）。
- `blog`／`otaku`／`mail`／`calendar` 四筆指向 `ghs.google.com`，
  在 Cloudflare 一律要設成 **DNS-only（灰雲）**，開代理會壞。
- apex 四筆與 `gaia` 指向 GitHub Pages，同樣建議 DNS-only，
  免得 Cloudflare 代理與 GitHub 的憑證／導向互相打架。
- 換來的東西（Workers 可用、apex 能上 Pages、DNS 介面好用、TTL 可調、
  可以順手補 SPF／DKIM／DMARC）**沒有一項是「把 aoe 搬到 Cloudflare」需要的**。

**判準：B 案是一個獨立的專案，不要把它綁進這次搬遷。**
先用 A 案把 `aoe` 搬完、跑順，日後若 `gaia` 也要搬、或真的想補齊 email 記錄，
再單獨排一次 zone 遷移，那時 A 案已經證明 Pages 這條路可行，風險反而更低。

---

## Cloudflare Pages 專案設定

用 Git 整合（Cloudflare 直接讀 repo、自己跑建置），不走 GitHub Actions + wrangler。

| 欄位 | 值 |
|---|---|
| Framework preset | None（選 Vite 也行，結果相同） |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |
| Production branch | `main` |
| 環境變數 | 不需要 |

幾件要知道的事：

**不設 `GITHUB_ACTIONS` / `GITHUB_REPOSITORY` 正是我們要的。** 見上面「結論」第 1 點。
不要為了「保險」在 Pages 的環境變數裡補上這兩個，那會把 `base` 推成 `/aoe/`，
整站 assets 404。

**Node 版本要 pin。** Pages v3 建置映像預設 Node 22.16.0，對 Vite 7
（要 20.19+／22.12+）夠用，但預設值會隨映像版本改，而 repo 裡目前唯一的版本宣告
是 `deploy.yml` 的 `node-version: 22`（`package.json` 沒有 `engines`，v3 映像也
不讀 `engines`）。**收尾階段**加一份 `.nvmrc`（內容 `22`），順便把 `deploy.yml`
改成 `node-version-file: .nvmrc` —— 並存期先不要動 workflow。

**Git 整合要授權 Cloudflare 的 GitHub App**，安裝時可以只勾 `kigichang/aoe`
這一個 repo。

**全新的 Cloudflare 帳號在頭 48 小時內建專案會受限。** 當天卡住多半是這個原因，
不是設定錯。

**每個非 `main` 分支的 push 會產生 preview 部署，網址是公開的。**
repo 本來就是公開的，可接受；不想要就在專案設定裡把 preview 部署關掉。

**建置的副作用是安全的。** `vite.config.ts` 會在 repo 根目錄寫出
`<slug>/index.html`（那些是 gitignored 的建置產物）。Cloudflare 的建置沙箱是
一次性的 checkout，寫進去沒有影響。

---

## 並存期

Pages 專案建好之後網址是 `https://<project>.pages.dev`，這時 GitHub Pages
完全不動、`aoe.kigi.tw` 照舊。

因為 `base` 是 `'/'`、`pages.dev` 也掛在根目錄，**驗證環境跟正式一模一樣**，
在 pages.dev 上跑一次下面的驗證清單就有效。

---

## 切換步驟

1. Pages 後台 → **Custom domains** → 加 `aoe.kigi.tw`，記下它給的 CNAME 目標。
2. cyberdns：把第 11 筆 `aoe` 的值改成該目標。
3. 等 Cloudflare 簽憑證（通常數分鐘）。**這段期間 HTTPS 可能短暫失敗**，
   挑離峰時間做。
4. 對 `https://aoe.kigi.tw` 再跑一次驗證清單。
5. 觀察一到兩週。

### TTL 是 3600 而且改不了 —— 但這裡不需要處理

cyberdns 的主機檔案設定面板**沒有 TTL 欄位**，實測所有記錄一律 3600（一小時），
所以「切換前先把 TTL 調小」這個標準作法在這裡做不到。

**不用處理，因為新舊兩邊服務的是同一份內容。** 改完 DNS 之後最多一小時內，
外面的解析器有的還快取著 `kigichang.github.io`、有的已經換成 `pages.dev`，
但兩邊都是同一個 commit 建出來的站，讀者不會察覺。

**唯一要守的前提是：這一小時內 GitHub Pages 必須還活著。** 也就是
`public/CNAME`、GitHub Settings → Pages 的 Custom domain、`deploy.yml`
三樣都還在（本來就是退路的前提，見下）。這也是為什麼收尾一定要等觀察期
結束才做 —— 提早拆掉 GitHub 那邊，會讓還在快取舊值的讀者看到 404。

### 退路

把 cyberdns 的 `aoe` CNAME 改回 `kigichang.github.io` 就回去了。

**前提是觀察期內這三樣都不要動**：GitHub Settings → Pages 的 Custom domain 設定、
`public/CNAME`、`.github/workflows/deploy.yml`。少一樣，退路就不是即時的
（要重新設定 + 重跑一次部署）。

---

## 觀察期結束後的收尾（一次做完）

1. GitHub **Settings → Pages** 移除 Custom domain，Source 設回 None。
2. 刪 `.github/workflows/deploy.yml`。
3. **`public/CNAME` 與 `vite.config.ts` 的 `base` 必須同時處理：**
   - 刪 `public/CNAME`。
   - `vite.config.ts` 把 `hasCustomDomain`、`repo` 與那個三元判斷整段拿掉，
     `base` 直接寫 `'/'`。

   **只刪 CNAME 不改 config 是錯的。** 那樣 `base` 的邏輯會落到 `/aoe/` 那條分支，
   實務上因為 Cloudflare 沒設 `GITHUB_ACTIONS` 所以結果仍是 `'/'` —— 但那是靠
   「另一個平台剛好沒設某個環境變數」撐著的巧合，不是設計。
4. 文件同步（這些地方目前都以 GitHub Pages 為前提在寫）：
   - `CLAUDE.md`「**`base` 由 `public/CNAME` 在不在決定**」整段，含底下那段
     `GET https://aoe.kigi.tw/aoe/assets/… 404` 的症狀描述。
   - `CLAUDE.md`「**為什麼每個主題要有實體的 index.html**」—— 結論不變
     （Cloudflare Pages 一樣是純靜態、沒有 server-side rewrite），
     但理由的主語要改。
   - `README.md`「## 部署到 GitHub Pages」整段（約 48–72 行），
     以及約 126 行那句「GitHub Pages 沒有 server-side rewrite」。
   - `src/lib/topic.ts` 與 `src/lib/data.ts` 註解裡提到 GitHub Pages `/<repo>/`
     的地方。
5. 加 `.nvmrc`（見上面「Node 版本要 pin」）。
6. 刪掉這份 `CLOUDFLARE.md`。

---

## 行為差異對照

| 項目 | GitHub Pages（實測） | Cloudflare Pages |
|---|---|---|
| `/tw-railway` 無尾斜線 | 301 → `/tw-railway/` | 自動補尾斜線（**要驗**） |
| 未知路徑 | GitHub 的 404 頁 | Cloudflare 通用 404（repo 沒有 `public/404.html`） |
| `/CNAME` | 會被服務出來 | 一樣（無害，收尾時會刪） |
| HTTPS 憑證 | GitHub 自動 | Cloudflare 自動 |
| 靜態資源快取 | GitHub 預設 | hashed assets 長快取；要微調可加 `public/_headers`（現階段不必） |

---

## 驗證清單

**在 `<project>.pages.dev` 與切換後的 `aoe.kigi.tw` 各跑一次。**

1. `/` 載入世界史，`<title>` 是 `AoE · 世界史`。
2. `/tw-railway/`、`/religion/`、`/science/`、`/art/` 四個都載得起來，
   各自的 `<title>` 與 meta description 正確 —— 這是在確認 `transformIndexHtml`
   有對每個 entry 生效，不是只有根目錄那份。
3. `/tw-railway`（無尾斜線）會導到 `/tw-railway/`。
4. 深連結 `/#y=-221&z=2&e=cn-qin-unification` 打開就定位在秦統一、事件被選中、
   詳情面板開著。**這條是最重要的相容性驗證** —— `world` 之所以設 `root: true`
   就是為了保住這種既有的分享連結，根網址的語意不能變。
5. 主題切換器每一列都連得到（連結是 `BASE_URL + slug/`）。
6. `/favicon.svg`、`/favicon.ico`、`/apple-touch-icon.png` 都 200，
   而且在子目錄主題底下也要對（`index.html` 刻意寫絕對路徑就是為了這個）。
7. `/assets/main-*.js`、`/assets/main-*.css` 都 200 且 Content-Type 正確。
   `base` 錯的話這裡會 404，是最有辨識度的症狀。
8. 暗色系統下開站不閃白底（`index.html` `<head>` 裡的防閃爍 inline script）。
9. 隨便打一個不存在的路徑，確認是 404 而不是空白頁。
10. 視窗寬度 < 1100px 時詳情面板是貼底抽屜。

---

## 費用

全部落在免費方案內：

| 項目 | 免費額度 | 本站 |
|---|---|---|
| 建置次數 | 500 次／月 | 遠低於 |
| 並行建置 | 1 | 夠 |
| 建置逾時 | 20 分鐘 | 遠低於 |
| 流量／請求 | 無限 | — |
| 檔案數 | 20,000／站 | 10 |
| 單檔大小 | 25 MiB | 最大 1.2MB（`assets/main-*.js`） |
| 自訂網域 | 100／專案 | 1 |

---

## 不要做的事

- **不要為了「官方主推 Workers」而改用 Workers。** zone 不在 Cloudflare 時，
  自訂網域根本掛不上去。
- **不要加 `_redirects` 做 SPA fallback。** 多主題實體 HTML 的設計就是為了不需要它
  （見 CLAUDE.md「為什麼每個主題要有實體的 index.html」），加了反而會把
  `/tw-railway/` 這類路徑吃掉。
- **不要在 Pages 的環境變數裡補 `GITHUB_ACTIONS` 或 `GITHUB_REPOSITORY`。**
- **並存期不要刪 `deploy.yml` 或 `public/CNAME`，也不要動 GitHub 的
  Custom domain 設定** —— 那三樣就是退路本身。
