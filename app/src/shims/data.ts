import { z } from 'zod'
import {
  categorySchema,
  eventSchema,
  periodSchema,
  regionSchema,
  timelineSchema,
  topicSchema,
  type Category,
  type CategoryDef,
  type Region,
  type Timeline,
  type TopicMeta,
} from '@web/lib/schema'
import {
  assertActualYearBeforeMinYear,
  assertInRange,
  assertKnownCategory,
  assertNoOverlap,
  assertUniqueIds,
} from '@web/lib/validate'
import type { ViewPayload } from '../types'

/**
 * 取代 ../src/lib/data.ts（由 vite.config.ts 的 aoe-shims 外掛換掉）。
 *
 * **匯出的名字與型別必須跟原版一模一樣**——scale.ts、search.ts、App.tsx、
 * TopicSwitcher 全靠這些。這裡不做任何資料合併，只把 payload 拆開來，
 * 並用網站的 Zod schema 再驗一次形狀（Rust 端是 serde，兩邊鏡像，
 * 這道檢查是抓「兩邊改 schema 漏改一邊」的）。
 *
 * 語意檢查（id 唯一、時期不重疊、範圍內…）Rust 端載入 YAML 時做過一次，
 * 這裡用網站的 validate.ts 再跑一次 —— 跨主題 View 是 Rust 合併出來的，
 * 合併邏輯出錯（例如 offset 後的範圍）也要在載入期就吵出來。
 */
const raw = window.__AOE_DATA__
if (!raw) {
  throw new Error('window.__AOE_DATA__ 不存在：main.tsx 必須經由 bootstrap.ts 載入。')
}

function parse<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const r = schema.safeParse(value)
  if (!r.success) {
    const issues = r.error.issues.map((i) => `  [${i.path.join('.')}] ${i.message}`).join('\n')
    throw new Error(`payload ${where} 格式錯誤：\n${issues}`)
  }
  return r.data
}

const payload: ViewPayload = raw

export const TOPIC_ID: string = payload.viewId
export const TOPIC: TopicMeta = parse(topicSchema, payload.topic, 'topic')
export const TIMELINE: Timeline = parse(timelineSchema, payload.timeline, 'timeline')

/**
 * 跨主題 View 的類別可能超過六個（各主題的表合併），所以這裡不套
 * `categoryListSchema.max(6)`——那是「編一個主題的資料」時的規則，
 * 不是「顯示」的規則。每一則的 glyph 仍來自它自己的主題。
 */
export const CATEGORIES: Record<string, CategoryDef> = Object.fromEntries(
  parse(z.array(categorySchema).min(1), payload.categories, 'categories').map((c) => [c.id, c]),
)
export const CATEGORY_IDS: Category[] = Object.keys(CATEGORIES)

export interface TopicEntry {
  slug: string
  meta: TopicMeta
  href: string
  isCurrent: boolean
  timeline: Timeline | null
}

export const TOPICS: TopicEntry[] = payload.topics

const regionWithData = regionSchema.extend({
  periods: z.array(periodSchema),
  events: z.array(eventSchema),
})

export const REGIONS: Region[] = parse(z.array(regionWithData), payload.regions, 'regions')
  .sort((a, b) => a.order - b.order)
  .map((r) => {
    const where = `${TOPIC_ID}/${r.id}`
    assertUniqueIds(r.periods, `${where}/periods`)
    assertUniqueIds(r.events, `${where}/events`)
    assertNoOverlap(r.periods, where)
    assertKnownCategory(r.events, CATEGORIES, `${where}/events`, TOPIC_ID)
    assertActualYearBeforeMinYear(r.events, TIMELINE, `${where}/events`)
    assertInRange(
      r.periods.map((p) => ({ id: p.id, from: p.start, to: p.end })),
      TIMELINE,
      `${where}/periods`,
      TOPIC_ID,
    )
    assertInRange(
      r.events.map((e) => ({ id: e.id, from: e.year, to: e.endYear ?? e.year })),
      TIMELINE,
      `${where}/events`,
      TOPIC_ID,
    )
    return {
      ...r,
      events: [...r.events].sort((a, b) => a.year - b.year),
      trackCount: Math.max(1, ...r.periods.map((p) => p.track + 1)),
    }
  })

assertUniqueIds(REGIONS, `${TOPIC_ID}/regions`)

export const HAS_TRUNCATED_EVENTS = REGIONS.some((r) =>
  r.events.some((e) => e.actualYear !== undefined),
)
