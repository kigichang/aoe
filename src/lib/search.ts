import { CATEGORIES, TOPIC } from './data'
import type { HistEvent, Region } from './schema'

export interface Indexed {
  event: HistEvent
  region: Region
  slot: number
}

/** 內部用的命中欄位代號 */
type Why = keyof typeof WEIGHT

export interface Hit extends Indexed {
  /**
   * 命中的欄位，讓結果列表可以說明「為什麼這則會出現」。
   *
   * **是顯示用的字串，不是代號** —— 「欄位」那一項會換成當前主題的
   * `columnLabel`（世界史是「地區」，鐵道史可能是「路線」），
   * 所以型別是 string 而不是字面值聯集。
   */
  why: string
}

/**
 * 額外的比對來源。**選填，網站不傳** —— 目前只有桌面版（`app/`）用它比對 Tag，
 * 而 Tag 不在 `HistEvent` 上（存在桌面版自己的 SQLite），這裡看不到也不該看到。
 *
 * 回傳的是**要顯示在結果列上的字串**（例如 `Tag：清代`），沒命中就回 null ——
 * 由呼叫端決定怎麼講，`search.ts` 不需要知道那是什麼東西。
 *
 * 注意 `q` 已經 trim 過並轉小寫，跟其他幾個欄位拿到的是同一份。
 */
export type ExtraMatch = (event: HistEvent, q: string) => string | null

/** 命中欄位的優先序：標題最直接，類別最鬆 */
const WEIGHT = { 標題: 5, 年份: 4, 描述: 3, 欄位: 2, 類別: 1 } as const

/** 對外顯示時，「欄位」換成主題自己的說法 */
const label = (why: Why) => (why === '欄位' ? TOPIC.columnLabel : why)

/**
 * 搜尋是**導覽**，不是篩選。
 *
 * 一開始考慮過讓搜尋直接篩掉不符的事件，但那會毀掉這個網站唯一的承諾 ——
 * 橫向對照需要各區的事件都在原位。而且符合的結果散佈在五千年裡，
 * 篩完只會得到一條到處是空洞的時間軸。所以搜尋只產生一份清單，
 * 點了就跳過去，時間軸本身完全不動。
 *
 * 中文不做斷詞，直接子字串比對就夠了：使用者輸入的多半是「鴉片」
 * 「馬關」這種詞根，斷詞反而容易切錯。
 *
 * `extra` 見 `ExtraMatch`。它**排在鏈的最後、權重 0**，所以只有原本五個欄位
 * 全都不命中的事件才會被它撈進來 —— 既有的命中與排序完全不受影響，
 * 不傳的時候那條分支永遠短路。
 */
export function search(query: string, all: Indexed[], limit = 10, extra?: ExtraMatch): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  // 純數字視為年份查詢：「1895」要找得到馬關條約
  const numeric = /^\d+$/.test(q)

  const hits: (Hit & { weight: number })[] = []
  for (const item of all) {
    const { event, region } = item
    let why: Why | null = null

    if (event.title.toLowerCase().includes(q)) why = '標題'
    else if (numeric && String(Math.abs(event.year)).includes(q)) why = '年份'
    else if (event.desc?.toLowerCase().includes(q)) why = '描述'
    else if (region.name.toLowerCase().includes(q)) why = '欄位'
    else if (CATEGORIES[event.category].label.includes(q)) why = '類別'

    if (why) {
      hits.push({ ...item, why: label(why), weight: WEIGHT[why] })
      continue
    }
    const extraWhy = extra?.(event, q)
    if (extraWhy) hits.push({ ...item, why: extraWhy, weight: 0 })
  }

  hits.sort(
    (a, b) =>
      b.weight - a.weight ||
      b.event.importance - a.event.importance ||
      a.event.year - b.event.year,
  )
  return hits.slice(0, limit).map(({ weight: _weight, ...hit }) => hit)
}
