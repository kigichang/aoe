import type { CategoryDef, HistEvent, Period, Timeline } from './schema'

/**
 * 載入期的語意檢查。**寧可載入期整片白配一則明確訊息，也不要靜默掉資料** ——
 * 這裡每一道都對應一種「畫面看起來正常，資料其實錯了」的 bug（見 CLAUDE.md
 * 「實作過程中踩到的坑」）。
 *
 * 從 `data.ts` 抽出來成純函式，是為了讓不走 `import.meta.glob` 的載入端
 * （桌面版、打包工具）也能跑同一套檢查，而不是各自再寫一份。
 * 所有需要的脈絡（時間軸範圍、類別表、主題 id）都用參數傳，這支檔案不 import `data.ts`。
 */

export function assertUniqueIds(items: { id: string }[], where: string) {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`${where}：id 重複 "${item.id}"`)
    seen.add(item.id)
  }
}

/** 同一條 track 上的時期不可重疊，否則背景色帶會互相蓋掉。 */
export function assertNoOverlap(periods: Period[], where: string) {
  const byTrack = new Map<number, Period[]>()
  for (const p of periods) {
    const list = byTrack.get(p.track) ?? []
    list.push(p)
    byTrack.set(p.track, list)
  }
  for (const [track, list] of byTrack) {
    const sorted = [...list].sort((a, b) => a.start - b.start)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      if (cur.start <= prev.end) {
        throw new Error(
          `${where} track ${track}：時期重疊 — "${prev.name}"(…${prev.end}) 與 "${cur.name}"(${cur.start}…)。` +
            `請改用不同的 track。`,
        )
      }
    }
  }
}

/**
 * 事件與時期都必須落在時間軸的上下界之內。
 *
 * 沒有這道防護時，超出範圍的資料會被算成負的 y 座標、畫到畫布外面 ——
 * **不報錯、主控台乾淨、欄位標題的「N 則」還照算**，只是讀者永遠看不到它。
 * 實測一則 `year: -5000` 的事件會落在 `top: -1211px`，完全無聲無息。
 */
export function assertInRange(
  items: { id: string; from: number; to: number }[],
  timeline: Timeline,
  where: string,
  topicId: string,
) {
  const { minYear, maxYear } = timeline
  for (const { id, from, to } of items) {
    if (from < minYear || to > maxYear) {
      throw new Error(
        `${where}："${id}" 的年份 ${from}…${to} 超出時間軸範圍 ${minYear}…${maxYear}。` +
          `請修正資料，或調整 src/topics/${topicId}/timeline.yaml 的上下界。`,
      )
    }
  }
}

/**
 * `actualYear`（真實估計年代）只有在事件真的被時間軸起點截斷時才有意義，
 * 也就是必須早於 `minYear`。沒有這道防護的話，圖釘畫在 `year` 的位置、
 * 文字卻印著另一個年份，兩者對不上而且不會有任何報錯，比截斷本身更誤導。
 */
export function assertActualYearBeforeMinYear(events: HistEvent[], timeline: Timeline, where: string) {
  const { minYear } = timeline
  for (const e of events) {
    if (e.actualYear !== undefined && e.actualYear >= minYear) {
      throw new Error(
        `${where}："${e.id}" 的 actualYear (${e.actualYear}) 沒有早於時間軸起點 ` +
          `${minYear}，不需要（或不應該）填這個欄位。`,
      )
    }
  }
}

/**
 * 事件的 category 必須在當前主題的類別表裡。
 *
 * 類別是主題自訂的，schema 那邊只能驗到 string，所以合法性在這裡擋。
 * 沒有這道防護的話 `CATEGORIES[event.category]` 會是 undefined，
 * 在 `EventMark` 讀 `.glyph` 時才炸，而且訊息完全看不出是哪一筆資料的問題。
 */
export function assertKnownCategory(
  events: HistEvent[],
  categories: Record<string, CategoryDef>,
  where: string,
  topicId: string,
) {
  for (const e of events) {
    if (!categories[e.category]) {
      throw new Error(
        `${where}："${e.id}" 的類別 "${e.category}" 不存在。` +
          `\n主題 "${topicId}" 可用的類別：${Object.keys(categories).join('、')}` +
          `\n（要新增類別請編輯 src/topics/${topicId}/categories.yaml）`,
      )
    }
  }
}
