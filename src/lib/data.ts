import { z } from 'zod'
import {
  DEFAULT_CATEGORIES,
  categoryListSchema,
  eventSchema,
  periodSchema,
  regionSchema,
  timelineSchema,
  topicSchema,
  type Category,
  type CategoryDef,
  type HistEvent,
  type Period,
  type Region,
  type Timeline,
  type TopicMeta,
} from './schema'
import { TOPIC_SLUG } from './topic'

/**
 * 資料全部用 glob 載入，所以**新增一個主題或一個欄位都不必回來改這支程式**：
 * 放檔案 + 在該主題的 regions.yaml 加一筆就好。
 *
 * 路徑形狀：
 *   ../topics/<主題>/topic.yaml        主題設定（含 columnLabel、root）
 *   ../topics/<主題>/regions.yaml      欄位定義
 *   ../topics/<主題>/timeline.yaml     時間軸上下界
 *   ../topics/<主題>/categories.yaml   類別（選填，沒有就用預設六類）
 *   ../topics/<主題>/<欄位>/events.yaml
 *   ../topics/<主題>/<欄位>/periods.yaml
 *
 * 已知代價：glob 的 pattern 必須是靜態字串，eager 之後 Rollup 沒辦法依 entry
 * 切分，**所有主題的 YAML 會打進同一個共用 chunk**。目前的資料量（數百則事件）
 * 這個成本可以忽略。真的大到影響首屏時，作法是給每個主題一支自己的 entry module
 * 明確 import 自己的資料檔，**不要改成 `eager: false`** —— 那會讓資料變成 async，
 * MIN_YEAR 就沒辦法留在模組層，整個「改動很輕」的前提就沒了（見 topic.ts）。
 */
/**
 * glob 的第二個參數**必須是寫在原地的物件字面值** —— Vite 是靜態剖析這段的，
 * 抽成共用常數會在建置期報 "Expected the second argument to be an object literal"。
 * 所以下面六行的選項看起來重複，但不能抽掉。
 */
type Files = Record<string, unknown>

const topicFiles = import.meta.glob('../topics/*/topic.yaml', {
  eager: true,
  import: 'default',
}) as Files
const regionFiles = import.meta.glob('../topics/*/regions.yaml', {
  eager: true,
  import: 'default',
}) as Files
const timelineFiles = import.meta.glob('../topics/*/timeline.yaml', {
  eager: true,
  import: 'default',
}) as Files
const categoryFiles = import.meta.glob('../topics/*/categories.yaml', {
  eager: true,
  import: 'default',
}) as Files
const periodFiles = import.meta.glob('../topics/*/*/periods.yaml', {
  eager: true,
  import: 'default',
}) as Files
const eventFiles = import.meta.glob('../topics/*/*/events.yaml', {
  eager: true,
  import: 'default',
}) as Files

/** `../topics/world/topic.yaml` → `world` */
const topicSlugFromPath = (path: string) => path.split('/').at(-2)!
/** `../topics/world/taiwan/events.yaml` → `world` */
const topicSlugFromRegionPath = (path: string) => path.split('/').at(-3)!
/** `../topics/world/taiwan/events.yaml` → `taiwan` */
const regionIdFromPath = (path: string) => path.split('/').at(-2)!

function parse<T>(schema: z.ZodType<T>, raw: unknown, where: string): T[] {
  const result = z.array(schema).safeParse(raw ?? [])
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  [${i.path.join('.')}] ${i.message}`)
      .join('\n')
    throw new Error(`${where} 資料格式錯誤：\n${issues}`)
  }
  return result.data
}

function parseOne<T>(schema: z.ZodType<T>, raw: unknown, where: string): T {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  [${i.path.join('.')}] ${i.message}`)
      .join('\n')
    throw new Error(`${where} 資料格式錯誤：\n${issues}`)
  }
  return result.data
}

/* ------------------------------------------------------------------ *
 * 挑出當前主題
 * ------------------------------------------------------------------ */

const ALL_TOPICS = new Map<string, TopicMeta>()
for (const [path, raw] of Object.entries(topicFiles)) {
  const slug = topicSlugFromPath(path)
  ALL_TOPICS.set(slug, parseOne(topicSchema, raw, path))
}

if (ALL_TOPICS.size === 0) {
  throw new Error('找不到任何主題：src/topics/<主題>/topic.yaml 至少要有一份。')
}

/**
 * `root: true` 的主題掛在根網址。恰好一個 —— 沒設的話根網址是空白，
 * 設兩個的話哪個贏會取決於檔案順序，兩種都必須在載入期就吵出來。
 */
const rootSlugs = [...ALL_TOPICS].filter(([, t]) => t.root).map(([slug]) => slug)
if (rootSlugs.length !== 1) {
  throw new Error(
    rootSlugs.length === 0
      ? `沒有任何主題設定 root: true，根網址會是空白的。請在其中一個 topic.yaml 加上。` +
        `\n目前的主題：${[...ALL_TOPICS.keys()].join('、')}`
      : `有 ${rootSlugs.length} 個主題設定了 root: true（${rootSlugs.join('、')}），` +
        `只能有一個。`,
  )
}

/**
 * 當前主題的目錄名。網址沒有子路徑時（`/aoe/`）就是 root 主題。
 *
 * 打錯路徑時寧可載入期整片白配一則明確訊息，也不要靜默 fallback 到 root ——
 * 那會讓「連結壞掉」看起來像「資料不見了」。
 */
export const TOPIC_ID = TOPIC_SLUG ?? rootSlugs[0]

const activeTopic = ALL_TOPICS.get(TOPIC_ID)
if (!activeTopic) {
  throw new Error(
    `找不到主題 "${TOPIC_ID}"。可用的主題：${[...ALL_TOPICS.keys()].join('、')}。` +
      `\n（主題的網址路徑就是 src/topics/ 底下的目錄名，root: true 的那個掛在根網址。）`,
  )
}

/** 當前主題的設定。`columnLabel` 決定 UI 上「地區」那個詞怎麼稱呼。 */
export const TOPIC: TopicMeta = activeTopic

/** 只挑出屬於當前主題的檔案，其餘丟掉。 */
function ofActiveTopic(files: Record<string, unknown>, slugOf: (p: string) => string) {
  return Object.entries(files).filter(([path]) => slugOf(path) === TOPIC_ID)
}

function oneOfActiveTopic(files: Record<string, unknown>) {
  return ofActiveTopic(files, topicSlugFromPath)[0]
}

/* ------------------------------------------------------------------ *
 * 主題層的設定
 * ------------------------------------------------------------------ */

const timelineEntry = oneOfActiveTopic(timelineFiles)
if (!timelineEntry) {
  throw new Error(`主題 "${TOPIC_ID}" 缺少 timeline.yaml（時間軸的上下界）。`)
}

/** 時間軸的上下界。scale.ts 的 MIN_YEAR / MAX_YEAR 由此而來。 */
export const TIMELINE: Timeline = parseOne(
  timelineSchema,
  timelineEntry[1],
  timelineEntry[0],
)

/**
 * 年代跳轉按鈕也必須落在軸的範圍內。超出的話按鈕還在、按了卻會被夾到軸的兩端，
 * 看起來像「按了沒反應」—— 又是一個畫面正常但行為錯誤的情況。
 */
for (const y of TOPIC.jumps ?? []) {
  if (y < TIMELINE.minYear || y > TIMELINE.maxYear) {
    throw new Error(
      `${TOPIC_ID}/topic.yaml：跳轉年代 ${y} 超出時間軸範圍 ` +
        `${TIMELINE.minYear}…${TIMELINE.maxYear}。`,
    )
  }
}

const categoryEntry = oneOfActiveTopic(categoryFiles)

/**
 * 類別表。**每個主題可以有自己的一組** —— 世界史是政治／戰爭／文化…，
 * 鐵道史是通車／廢線／事故…。沒有 categories.yaml 就沿用預設六類。
 *
 * 形狀刻意跟以前寫死在 schema.ts 時一樣（`CATEGORIES[id].glyph`），
 * 所以引用端只需要換 import 路徑。
 */
export const CATEGORIES: Record<string, CategoryDef> = Object.fromEntries(
  (categoryEntry
    ? parseOne(categoryListSchema, categoryEntry[1], categoryEntry[0])
    : DEFAULT_CATEGORIES
  ).map((c) => [c.id, c]),
)

export const CATEGORY_IDS: Category[] = Object.keys(CATEGORIES)

const regionEntry = oneOfActiveTopic(regionFiles)
if (!regionEntry) {
  throw new Error(`主題 "${TOPIC_ID}" 缺少 regions.yaml（欄位定義）。`)
}

/* ------------------------------------------------------------------ *
 * 欄位資料
 * ------------------------------------------------------------------ */

function byRegion<T>(files: Record<string, unknown>, schema: z.ZodType<T>) {
  const out = new Map<string, T[]>()
  for (const [path, raw] of ofActiveTopic(files, topicSlugFromRegionPath)) {
    out.set(regionIdFromPath(path), parse(schema, raw, path))
  }
  return out
}

const periodsByRegion = byRegion<Period>(periodFiles, periodSchema)
const eventsByRegion = byRegion<HistEvent>(eventFiles, eventSchema)

function assertUniqueIds(items: { id: string }[], where: string) {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`${where}：id 重複 "${item.id}"`)
    seen.add(item.id)
  }
}

/** 同一條 track 上的時期不可重疊，否則背景色帶會互相蓋掉。 */
function assertNoOverlap(periods: Period[], where: string) {
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
 * 這跟 assertNoOverlap 是同一種東西：寧可載入期整片白，也不要靜默掉資料。
 */
function assertInRange(items: { id: string; from: number; to: number }[], where: string) {
  const { minYear, maxYear } = TIMELINE
  for (const { id, from, to } of items) {
    if (from < minYear || to > maxYear) {
      throw new Error(
        `${where}："${id}" 的年份 ${from}…${to} 超出時間軸範圍 ${minYear}…${maxYear}。` +
          `請修正資料，或調整 src/topics/${TOPIC_ID}/timeline.yaml 的上下界。`,
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
function assertKnownCategory(events: HistEvent[], where: string) {
  for (const e of events) {
    if (!CATEGORIES[e.category]) {
      throw new Error(
        `${where}："${e.id}" 的類別 "${e.category}" 不存在。` +
          `\n主題 "${TOPIC_ID}" 可用的類別：${CATEGORY_IDS.join('、')}` +
          `\n（要新增類別請編輯 src/topics/${TOPIC_ID}/categories.yaml）`,
      )
    }
  }
}

export const REGIONS: Region[] = parse(regionSchema, regionEntry[1], regionEntry[0])
  .sort((a, b) => a.order - b.order)
  .map((meta) => {
    const periods = periodsByRegion.get(meta.id) ?? []
    const events = eventsByRegion.get(meta.id) ?? []
    const where = `${TOPIC_ID}/${meta.id}`
    assertUniqueIds(periods, `${where}/periods.yaml`)
    assertUniqueIds(events, `${where}/events.yaml`)
    assertNoOverlap(periods, where)
    assertKnownCategory(events, `${where}/events.yaml`)
    assertInRange(
      periods.map((p) => ({ id: p.id, from: p.start, to: p.end })),
      `${where}/periods.yaml`,
    )
    assertInRange(
      events.map((e) => ({ id: e.id, from: e.year, to: e.endYear ?? e.year })),
      `${where}/events.yaml`,
    )
    return {
      ...meta,
      periods,
      events: [...events].sort((a, b) => a.year - b.year),
      trackCount: Math.max(1, ...periods.map((p) => p.track + 1)),
    }
  })

assertUniqueIds(REGIONS, `${TOPIC_ID}/regions.yaml`)
