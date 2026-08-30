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
  /** 畫面上的事件 id → 全域 ref（"{topic}/{region}/{id}" 或 "user/…"） */
  refs: Record<string, string>
}

declare global {
  interface Window {
    __AOE_DATA__?: ViewPayload
  }
}

/* ---------------- View（跨主題欄位組合），對齊 src-tauri/src/model.rs ---------------- */

export interface ViewColumn {
  topic: string
  region: string
  /** -2…+2，各主題 importance 尺規不同時用來對齊 */
  importanceOffset: number
}

export interface View {
  id: string
  name: string
  minYear: number
  maxYear: number
  defaultPpy?: number
  order?: number
  /** 每主題一個的內建 View（id = 主題 slug），不能改也不能刪 */
  builtin: boolean
  columns: ViewColumn[]
}

/** 欄位選擇器用：每個主題有哪些欄位、時間軸多長 */
export interface TopicCatalog {
  slug: string
  meta: TopicMeta
  timeline: Timeline
  regions: RegionMeta[]
  categories: CategoryDef[]
}

/* ---------------- 使用者事件，對齊 model.rs 的 UserEvent ---------------- */

export interface Placement {
  topic: string
  region: string
  /** 該主題的類別 id */
  category: string
}

export interface UserEvent {
  /** "user/<uuid>" */
  ref: string
  year: number
  endYear?: number
  title: string
  desc?: string
  importance: number
  legendary: boolean
  sources: { title: string; url?: string }[]
  placements: Placement[]
}

/** 事件 id 以此開頭就是使用者自訂的（payload 裡它的 id 就是 ref） */
export const USER_EVENT_PREFIX = 'user/'

/* ---------------- Tag 與關聯，對齊 model.rs ---------------- */

export interface TagGroup {
  id: string
  name: string
  order: number
}

export interface Tag {
  id: string
  groupId?: string
  parentId?: string
  name: string
  color?: string
  order: number
  /** 打了這個 tag 的事件數（唯讀） */
  count: number
}

/** 一則事件的「現在」；orphan 表示 ref 已對不到事件，title 是快照 */
export interface EventHit {
  ref: string
  title: string
  year: number
  topic: string
  region: string
  topicName: string
  regionName: string
  /** 在自己主題的 View 裡的 id，用來組 ?view=…#e=… */
  eventId: string
  orphan: boolean
}

export interface EventLink {
  id: string
  from: EventHit
  to: EventHit
  kind: string
  note?: string
}

export interface LinkInput {
  id: string
  fromRef: string
  toRef: string
  kind: string
  note?: string
}

/** 關係類型的預設選項；kind 本身是自由字串 */
export const LINK_KINDS = ['導致', '回應', '延續', '對照', '其他'] as const
