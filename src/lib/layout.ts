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
/** 標籤列以中心定位，佔用區間就是中心上下各半列 */
const HALF_ROW = ROW_HEIGHT / 2

/**
 * 標籤離真實年份最多只能被推開幾「年」。
 *
 * 上限必須以年為單位、不能寫死像素：同樣 44px，在 0.6 px/年 的全域視角代表 73 年，
 * 在 5 px/年 只代表 9 年。寫死像素的話，縮得越遠誤差越大 —— 偏偏那正是拿來
 * 做跨區對照的視角。實測寫死 44px 時，前 300 年的歐幾里得與彌生文化會被畫成
 * 相距 43px，視覺上差了 72 年，而它們其實同年。
 *
 * 代價是低倍率下更多標籤會退化成只有圖釘。這是刻意的取捨：
 * 寧可少顯示，也不能讓「同時期」讀錯。
 */
const MAX_SHIFT_YEARS = 30
/** 但也不能真的縮到 0，否則稍微擠一下就整片只剩圖釘 */
const MIN_SHIFT_PX = 14
/** 高倍率下也不必無限放寬，超過兩列高就該退化了 */
const MAX_SHIFT_PX = 56

interface Slot {
  top: number
  bottom: number
}

/** 在一條標籤欄裡，從 y 往下找第一個放得下整列標籤的位置 */
function firstFreeBelow(occupied: Slot[], y: number): number {
  let center = y
  for (const slot of occupied) {
    // occupied 依 top 遞增，center 只會往下推，所以一輪掃描就夠
    if (center + HALF_ROW <= slot.top) break
    if (center - HALF_ROW < slot.bottom) center = slot.bottom + HALF_ROW
  }
  return center
}

/**
 * 把時間上重疊的標籤排進 laneCount 個並排的標籤欄。
 * 選位移最小的欄；位移超過上限就退化成只畫圖釘。
 *
 * **配置順序是重要度優先，不是年份先到先得。** 空間不足時該讓路的是次要事件；
 * 若照年份排，一個重要度 3 的事件會把十年後的重要度 5 擠成圖釘
 * （實測前 202 年劉邦稱帝、前 138 年張騫出使西域就是這樣掉的）。
 *
 * `ppy` 是 px/年，用來把位移上限從「年」換算成像素。
 */
export function placeEvents(
  events: HistEvent[],
  yOf: (year: number) => number,
  laneCount: number,
  ppy: number,
): PlacedEvent[] {
  const maxShift = Math.min(MAX_SHIFT_PX, Math.max(MIN_SHIFT_PX, MAX_SHIFT_YEARS * ppy))
  const lanes: Slot[][] = Array.from({ length: Math.max(1, laneCount) }, () => [])
  const result = new Map<string, PlacedEvent>()

  const byPriority = [...events].sort(
    (a, b) => b.importance - a.importance || a.year - b.year,
  )

  for (const event of byPriority) {
    const y = yOf(event.year)
    /*
     * 標籤是以中心定位的，所以正好落在畫布頂端（年份 = timeline.yaml 的 minYear）
     * 的事件，上半列會跑到內容區外面被 sticky 欄位標題蓋住 —— 實測台灣的
     * 「前3000 大坌坑文化」是 top: -11px，只看得到下面一半。
     *
     * 這是邊界事件的通則問題，不是 minYear 的值不對：把 minYear 往前調，
     * 同樣的事情只會換成新的最早那一則。所以在排版層夾住，不動資料。
     *
     * 位移最多 HALF_ROW（11px），一定小於 maxShift 的下限 MIN_SHIFT_PX（14px），
     * 不會害事件退化成只剩圖釘。而且照樣會畫引線指回真實年份。
     */
    const floor = Math.max(y, HALF_ROW)

    let best: { lane: number; labelY: number } | null = null
    for (let i = 0; i < lanes.length; i++) {
      const labelY = firstFreeBelow(lanes[i], floor)
      if (labelY - y > maxShift) continue
      // 位移最小的欄；平手時留在較左邊，讀起來順
      if (!best || labelY < best.labelY) best = { lane: i, labelY }
    }

    if (!best) {
      // 只畫圖釘的事件不佔標籤欄空間，讓後面的事件還有機會
      result.set(event.id, { event, y, labelY: y, lane: 0, dotOnly: true })
      continue
    }

    const slots = lanes[best.lane]
    slots.push({ top: best.labelY - HALF_ROW, bottom: best.labelY + HALF_ROW })
    slots.sort((a, b) => a.top - b.top)
    result.set(event.id, { event, y, labelY: best.labelY, lane: best.lane, dotOnly: false })
  }

  // 依年份順序輸出，渲染結果才穩定
  return events.map((e) => result.get(e.id)!)
}

/** 被強調的事件一律當成最高重要度看待 */
export const HIGHLIGHT_IMPORTANCE = 5

/**
 * 把「被強調的那組事件」的重要度墊到最高。
 *
 * 為什麼是改 importance 而不是另開一個旗標：重要度同時管兩件事 ——
 * 縮放層級的門檻（`minImportance`）與排版的佔位順序（`placeEvents` 是
 * 重要度優先）。強調的目的是「不必放大就看得到，而且不會被鄰居擠成圖釘」，
 * 兩件事都要，墊 importance 一次到位。
 *
 * 覆寫的是**複本**：`REGIONS` 裡的事件、詳情面板拿到的那則都還是原值，
 * 所以取消強調只是不再套這一層，沒有「還原重要度」這種需要記帳的狀態。
 *
 * `ids` 沒傳或是空的就原樣回傳（連複製都不做）—— 網站永遠走這條。
 */
export function highlightImportance(
  events: HistEvent[],
  ids?: ReadonlySet<string>,
): HistEvent[] {
  if (!ids?.size) return events
  return events.map((e) =>
    ids.has(e.id) ? { ...e, importance: HIGHLIGHT_IMPORTANCE } : e,
  )
}
