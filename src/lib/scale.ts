/**
 * 年份 ↔ 像素。整條軸是線性的，靠縮放（pxPerYear，簡稱 ppy）處理
 * 「古代稀疏、近代密集」的問題，而不是用非線性刻度 —— 非線性刻度會讓
 * 「同時期」這個核心比較失去直覺。
 */
import { TIMELINE } from './data'
/**
 * 上下界來自當前主題的 `timeline.yaml`，不寫死在這裡 —— 寫死的值會安靜地過期
 * （`MAX_YEAR` 原本是 2025，跨年之後軸的下緣就停在去年了）。
 * 超出範圍的資料由 `data.ts` 的 `assertInRange` 在載入期擋下。
 */
export const MIN_YEAR = TIMELINE.minYear
export const MAX_YEAR = TIMELINE.maxYear
export const SPAN_YEARS = MAX_YEAR - MIN_YEAR

/**
 * 名目視窗高度。實際高度由使用者的視窗決定，這裡只需要一個穩定的基準，
 * 好把「整條軸大約一屏」這種說法換算成 ppy。
 */
const NOMINAL_VIEWPORT_H = 700

/**
 * 縮到最小時，整條軸大約剛好一屏 —— 再縮下去只是讓內容更擠，看不到更多東西。
 *
 * **必須依主題的跨度算，不能寫死。** 0.15 是為五千年跨度挑的：一個
 * 1885–2026 的主題套上 0.15，整條軸只有 21px 高，所有事件疊成一團。
 */
export const MIN_PPY = NOMINAL_VIEWPORT_H / SPAN_YEARS

/**
 * 放到最大時的 ppy。40 px/年 對五千年的主題來說已經是「一年一列半」的細節，
 * 夠用了；跨度短的主題 MIN_PPY 本身就高，所以再保底給八倍的縮放範圍。
 */
export const MAX_PPY = Math.max(40, MIN_PPY * 8)

export const clampPpy = (ppy: number) => Math.min(MAX_PPY, Math.max(MIN_PPY, ppy))

export const yearToY = (year: number, ppy: number) => (year - MIN_YEAR) * ppy
export const yToYear = (y: number, ppy: number) => y / ppy + MIN_YEAR
export const totalHeight = (ppy: number) => SPAN_YEARS * ppy

/** 顯示用：-221 → 「前221」 */
export const fmtYear = (year: number) => (year < 0 ? `前${-year}` : `${year}`)

/** 詳情面板用：-221 → 「西元前 221 年」 */
export const fmtYearLong = (year: number) =>
  year < 0 ? `西元前 ${-year} 年` : `西元 ${year} 年`

export const fmtRange = (start: number, end?: number) =>
  end === undefined || end === start
    ? fmtYearLong(start)
    : `${fmtYearLong(start)} – ${fmtYear(end)}`

/**
 * 顯示一律用 `actualYear`（若有），`year` 只留給 `yearToY` 之類的座標計算 ——
 * 兩者分工：一個決定畫在哪裡，一個決定文字寫什麼，讀者看到的數字永遠是
 * 真實年代，不會在同一行看到兩個不同的年份互相打架。
 */
export const displayYear = (event: { year: number; actualYear?: number }) =>
  event.actualYear ?? event.year

const TICK_STEPS = [1, 5, 10, 25, 50, 100, 250, 500, 1000]

/** 挑一個讓刻度間距至少 targetPx 的最小級距。 */
export function tickStep(ppy: number, targetPx = 88) {
  return TICK_STEPS.find((step) => step * ppy >= targetPx) ?? 1000
}

export function ticks(ppy: number): number[] {
  const step = tickStep(ppy)
  const out: number[] = []
  const first = Math.ceil(MIN_YEAR / step) * step
  for (let y = first; y <= MAX_YEAR; y += step) out.push(y === 0 ? 1 : y)
  return out
}

/**
 * 開場的縮放。主題沒指定就取「整條軸大約兩屏」——
 * 對事件不多的主題來說剛好一眼看完，密的主題請自己在 topic.yaml 指定。
 */
export const defaultPpy = (topicValue?: number) => clampPpy(topicValue ?? MIN_PPY * 2)

/**
 * 年代跳轉按鈕的預設值：在軸的範圍內取整數級距。
 *
 * 主題有填 `jumps` 就用它的 —— 手挑的能反映資料密度（世界史愈近代愈密），
 * 這裡只保證「沒填也不會壞掉」，不保證好看。
 */
export function defaultJumps(count = 8): number[] {
  const step = TICK_STEPS.find((s) => SPAN_YEARS / s <= count) ?? 1000
  const out: number[] = []
  for (let y = Math.ceil(MIN_YEAR / step) * step; y <= MAX_YEAR; y += step) {
    out.push(y === 0 ? 1 : y)
  }
  return out
}

/**
 * 縮放層級決定顯示到第幾級的事件。全域視角只留下最重要的那些，
 * 否則五千年的事件全部擠在一屏，什麼都讀不到。
 *
 * `[ppy 下界, 該層級最低顯示的重要度]`，由小到大。
 * **正查與反查共用這一張表** —— 搜尋跳轉要反過來問「這則要放大到多少才看得到」，
 * 兩邊各寫一份門檻的話遲早會走鐘。
 */
const TIERS: readonly (readonly [number, number])[] = [
  [0, 5],
  [0.4, 4],
  [1.2, 3],
  [4, 2],
  [12, 1],
]

export function minImportance(ppy: number) {
  let out = 5
  for (const [from, imp] of TIERS) if (ppy >= from) out = imp
  return out
}

/**
 * 反查：要讓這個重要度的事件顯示出來，至少得放大到多少 px/年。
 * 搜尋跳到一則重要度 3 的事件時，若停在全域視角那則根本不會被畫出來，
 * 使用者只會看到一片空白。
 */
export function ppyForImportance(importance: number) {
  for (const [from, imp] of TIERS) if (imp <= importance) return Math.max(MIN_PPY, from)
  return MAX_PPY
}
