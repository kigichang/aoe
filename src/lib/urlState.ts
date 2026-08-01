/**
 * 把「現在在看哪裡」放進網址的 hash，讓人可以分享某個年代或某則事件。
 *
 *   #y=-221&z=0.6            西元前 221 年，全域視角
 *   #y=1592&z=2&e=cn-imjin-war   放大到明清，並選中萬曆朝鮮之役
 *
 * 用 hash 而不是 query string：GitHub Pages 是靜態站，hash 純粹在瀏覽器端，
 * 不會多送一次請求，也不必顧慮快取或 `base` 的路徑處理。
 *
 * 一律用 `replaceState` 寫入，**不留歷史紀錄** —— 捲動是連續動作，
 * 每捲一下就塞一筆上一頁，返回鍵會變得無法使用。
 *
 * **篩選狀態刻意不放進網址。** 分享時對方應該看到完整的四個地區；
 * 若把「我關掉了日本欄」也一起傳過去，對方只會覺得資料不見了。
 * 網址表達的是「看哪裡」，不是「我調過哪些開關」。
 */
import { MAX_YEAR, MIN_YEAR, clampPpy } from './scale'

export interface UrlState {
  year: number | null
  ppy: number | null
  eventId: string | null
}

/** 夾進軸的範圍，並避開不存在的西元 0 年 */
function normalizeYear(raw: number): number {
  const y = Math.round(raw)
  if (y === 0) return 1
  return Math.min(MAX_YEAR, Math.max(MIN_YEAR, y))
}

export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const y = Number(params.get('y'))
  const z = Number(params.get('z'))
  const e = params.get('e')
  return {
    year: params.has('y') && Number.isFinite(y) ? normalizeYear(y) : null,
    ppy: params.has('z') && Number.isFinite(z) && z > 0 ? clampPpy(z) : null,
    eventId: e || null,
  }
}

/** 上一次寫進去的 hash，用來擋掉沒有變化的 replaceState */
let lastHash: string | null = null

export function writeUrlState(state: { year: number; ppy: number; eventId: string | null }) {
  const params = new URLSearchParams()
  params.set('y', String(normalizeYear(state.year)))
  // 縮放留三位有效數字就夠了，不然網址會出現 0.6000000000000001
  params.set('z', String(Number(state.ppy.toPrecision(3))))
  if (state.eventId) params.set('e', state.eventId)

  // URLSearchParams 會把 `-` 之外的字元編碼，但年份的負號與事件 id 都是
  // 安全字元，解碼回來讀起來比較像人看的網址
  const hash = '#' + params.toString().replace(/%2C/g, ',')
  if (hash === lastHash) return
  lastHash = hash
  history.replaceState(null, '', hash)
}
