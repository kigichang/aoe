/**
 * 從網址推出「現在在看哪一個主題」。
 *
 * **主題是 per-document 的常數，不是 React state。** 每個主題有自己的 HTML entry
 * （`/aoe/` 與 `/aoe/tw-railway/` 是兩份不同的 index.html），所以瀏覽器一載入
 * 這件事就已經定了，不會在執行期改變。
 *
 * 這是整個多主題設計能做得很輕的關鍵：`MIN_YEAR`、`REGIONS`、`CATEGORIES`
 * 全部可以維持模組層常數，只是值改由當前主題決定。`layout.ts`、`urlState.ts`
 * 與所有繪圖元件因此一行都不用改。
 *
 * **不要為了「主題可即時切換」把它改成 state** —— 那會讓 `scale.ts` 的
 * `MIN_YEAR / MAX_YEAR / SPAN_YEARS` 變成函式參數，一路擴散到每一支檔案。
 * 換主題就整頁重新載入，成本比那個改動低太多。
 *
 * 這支刻意不 import `data.ts`：資料載入要靠它決定讀哪一份，反過來 import 會循環。
 */

/**
 * `import.meta.env.BASE_URL` 是 `/aoe/`（GitHub Pages）或 `/`（本機）。
 * 把它從 pathname 前面剝掉，剩下的第一段就是主題目錄名。
 *
 *   /aoe/tw-railway/  → 'tw-railway'
 *   /aoe/             → null（＝ 掛在根網址的那個主題）
 *   /aoe/index.html   → null
 */
export function slugFromPath(pathname: string, base: string): string | null {
  let rest = pathname
  if (base !== '/' && rest.startsWith(base)) rest = rest.slice(base.length)
  else if (base !== '/' && rest === base.slice(0, -1)) rest = ''
  else if (base === '/') rest = rest.slice(1)

  // 去掉結尾的檔名與斜線，只留第一段
  const first = rest.split('/').filter((s) => s && !s.endsWith('.html'))[0]
  return first ?? null
}

/** 當前主題的目錄名。null 表示要用設了 `root: true` 的那個主題。 */
export const TOPIC_SLUG = slugFromPath(window.location.pathname, import.meta.env.BASE_URL)
