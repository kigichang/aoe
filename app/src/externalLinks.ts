import { openUrl } from '@tauri-apps/plugin-opener'

/**
 * 外部連結改用系統預設瀏覽器開啟。
 *
 * 網站的外部連結一律是 `<a target="_blank">`（詳情面板的出處與事件連結、
 * 說明裡的儲存庫連結、回報面板的 issues 與 mailto）。瀏覽器會開新分頁，
 * **WebView 不會** —— 它沒有分頁，也不讓頁面自己開視窗，於是點下去完全沒反應：
 * 不導覽、不報錯、console 乾淨。這正是本專案最該防的那種「畫面看起來正常，
 * 功能其實壞了」的壞法。
 *
 * **修法刻意是在 document 上攔截，不是給 `DetailPanel` 加一個開連結的擴充點。**
 * 「在 WebView 裡點外部連結」是整個桌面版共通的環境差異，不是某一塊 UI 的功能；
 * 做成擴充點的話，網站每多一個 `target="_blank"` 就要記得多傳一次，
 * 而漏掉的症狀就是上面那種沒有訊息的無反應。攔在這裡，一次涵蓋全部。
 *
 * **這一支不能省，即使 opener plugin 自己就會攔。** plugin 會注入一段 init script，
 * 攔 `target="_blank"`（或 ctrl／shift 點擊）且協定是 http／https／mailto／tel 的連結。
 * 網站多數外部連結都有 `target`，所以那段涵蓋得到 —— 但涵蓋不到回報面板那個
 * 沒有 target 的 mailto，也刻意跳過 cmd／alt 點擊（在瀏覽器那是「下載／背景開啟」，
 * 在 WebView 一樣是沒反應）。這裡掛在 document 的冒泡階段，比它掛在 window 的早，
 * 攔到就 `preventDefault()`，它讀到 `defaultPrevented` 會自己跳過，不會開兩次。
 *
 * **判準是「跨來源」，不是 `target="_blank"`。** 主題切換器（`TopicSwitcher`）
 * 那種站內連結也可能帶 target，而且它的 `href` 是相對路徑 ——
 * `a.href` 讀出來已經被解析成 `http://localhost:1420/world/`，只看協定的話
 * 會把站內導覽也丟給外部瀏覽器。同來源一律放行，交給 WebView 自己走。
 */
const EXTERNAL_PROTOCOLS = new Set(['mailto:', 'tel:'])

function externalHref(target: EventTarget | null): string | null {
  const a = target instanceof Element ? target.closest('a[href]') : null
  if (!(a instanceof HTMLAnchorElement)) return null
  let url: URL
  try {
    url = new URL(a.href)
  } catch {
    return null
  }
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return a.href
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // `#e=…` 這類同來源連結（含純 hash）留給 WebView 自己處理
  return url.origin === location.origin ? null : a.href
}

function handle(e: MouseEvent) {
  // 已經有人處理掉這次點擊就不搶。監聽器掛在 document 的**冒泡**階段，
  // 比 React 綁在 root 容器上的處理器晚，`defaultPrevented` 才讀得到結果 ——
  // 同 DetailPanel 那條 Esc 分層規則的道理。
  if (e.defaultPrevented) return
  const href = externalHref(e.target)
  if (!href) return
  e.preventDefault()
  // 開不起來（沒有預設瀏覽器、URL 壞掉）時至少留一行，不要靜默失敗
  void openUrl(href).catch((err) => console.error(`開啟連結失敗：${href}`, err))
}

export function installExternalLinks() {
  document.addEventListener('click', handle)
  // 中鍵在瀏覽器是「開新分頁」，在 WebView 同樣沒反應。它不會觸發 click，
  // 要另外接 auxclick；行為跟左鍵一樣就好，反正只有一個視窗。
  document.addEventListener('auxclick', (e) => {
    if (e.button === 1) handle(e)
  })
}
