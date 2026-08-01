/**
 * 年份 ↔ 像素。整條軸是線性的，靠縮放（pxPerYear，簡稱 ppy）處理
 * 「古代稀疏、近代密集」的問題，而不是用非線性刻度 —— 非線性刻度會讓
 * 「同時期」這個核心比較失去直覺。
 */
import { TIMELINE } from './data'
/**
 * 上下界來自 `src/data/timeline.yaml`，不寫死在這裡 —— 寫死的值會安靜地過期
 * （`MAX_YEAR` 原本是 2025，跨年之後軸的下緣就停在去年了）。
 * 超出範圍的資料由 `data.ts` 的 `assertInRange` 在載入期擋下。
 */
export const MIN_YEAR = TIMELINE.minYear
export const MAX_YEAR = TIMELINE.maxYear
export const SPAN_YEARS = MAX_YEAR - MIN_YEAR

export const MIN_PPY = 0.15
export const MAX_PPY = 40

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
 * 縮放層級決定顯示到第幾級的事件。全域視角只留下最重要的那些，
 * 否則五千年的事件全部擠在一屏，什麼都讀不到。
 */
export function minImportance(ppy: number) {
  if (ppy < 0.4) return 5
  if (ppy < 1.2) return 4
  if (ppy < 4) return 3
  if (ppy < 12) return 2
  return 1
}
