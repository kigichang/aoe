import type { HistEvent } from './schema'

export interface PlacedEvent {
  event: HistEvent
  /** 事件在時間軸上的真實位置 */
  y: number
  /** 標籤實際被排到的位置（可能被往下推擠） */
  labelY: number
  /** 標籤被分到第幾欄 */
  lane: number
  /** 推不下去了 —— 只畫圖釘、不畫標籤 */
  dotOnly: boolean
}

const ROW_HEIGHT = 26
const ROW_GAP = 2

/**
 * 標籤離真實年份最多只能被推開這麼多。
 * 這個值必須壓得很小：一旦容許大幅位移，密集區段的位移會沿著時間累積，
 * 最後把後面的事件推到比它更晚的事件下方 —— 「同時期」就讀錯了。
 * 寧可退化成只有圖釘（放大就看得到），也不能讓順序失真。
 */
const MAX_SHIFT = 44

/**
 * 把時間上重疊的標籤排進 laneCount 個並排的標籤欄。
 * 優先塞進最左邊放得下的欄（讀起來順），塞不下才往右溢，
 * 全部都要大幅位移時就退化成只畫圖釘。
 */
export function placeEvents(
  events: HistEvent[],
  yOf: (year: number) => number,
  laneCount: number,
): PlacedEvent[] {
  const bottoms = new Array<number>(Math.max(1, laneCount)).fill(-Infinity)

  return events.map((event) => {
    const y = yOf(event.year)

    // 第一個不需要位移就放得下的欄
    let lane = bottoms.findIndex((bottom) => bottom + ROW_GAP <= y)
    if (lane < 0) {
      // 都放不下，挑最早空出來的那欄，位移最小
      lane = bottoms.reduce((best, bottom, i) => (bottom < bottoms[best] ? i : best), 0)
    }

    const labelY = Math.max(y, bottoms[lane] + ROW_GAP)
    const dotOnly = labelY - y > MAX_SHIFT
    // 只畫圖釘的事件不佔標籤欄的空間，所以不推進該欄的 bottom
    if (!dotOnly) bottoms[lane] = labelY + ROW_HEIGHT

    return { event, y, labelY, lane, dotOnly }
  })
}
