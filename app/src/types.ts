import type { CategoryDef, HistEvent, Period, RegionMeta, Timeline, TopicMeta } from '@web/lib/schema'

/**
 * Rust 端 `get_view_payload` 回來的東西，也就是 `window.__AOE_DATA__`。
 *
 * 形狀刻意對齊網站 `data.ts` 的匯出：shim 只是把它拆開來 export，
 * 不做任何轉換。跨主題的合併（類別加前綴、importance offset、範圍外過濾）
 * 全部在 Rust 端做完，前端看到的永遠是「一個主題」的樣子。
 */
export interface ViewPayload {
  /** 這次載入的 View id；Phase 0 就是主題的 slug */
  viewId: string
  topic: TopicMeta
  timeline: Timeline
  categories: CategoryDef[]
  regions: (RegionMeta & { periods: Period[]; events: HistEvent[] })[]
  /** 切換清單。`href` 是 `?view=<id>`，整頁重載，跟網站的 `<a href>` 一樣 */
  topics: { slug: string; meta: TopicMeta; href: string; isCurrent: boolean; timeline: Timeline | null }[]
}

declare global {
  interface Window {
    __AOE_DATA__?: ViewPayload
  }
}
