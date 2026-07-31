import { z } from 'zod'
import {
  eventSchema,
  periodSchema,
  regionSchema,
  type HistEvent,
  type Period,
  type Region,
} from './schema'
import regionsRaw from '../data/regions.yaml'

/**
 * 用 glob 載入，所以新增一個地區只要放檔案 + 在 regions.yaml 加一筆，
 * 不必回來改這支程式。
 */
const periodFiles = import.meta.glob('../data/*/periods.yaml', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const eventFiles = import.meta.glob('../data/*/events.yaml', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

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

function byPath<T>(files: Record<string, unknown>, schema: z.ZodType<T>) {
  const out = new Map<string, T[]>()
  for (const [path, raw] of Object.entries(files)) {
    out.set(regionIdFromPath(path), parse(schema, raw, path))
  }
  return out
}

const periodsByRegion = byPath<Period>(periodFiles, periodSchema)
const eventsByRegion = byPath<HistEvent>(eventFiles, eventSchema)

function assertUniqueIds(items: { id: string }[], where: string) {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`${where}：id 重複 "${item.id}"`)
    seen.add(item.id)
  }
}

/** 同一條 track 上的時期不可重疊，否則背景色帶會互相蓋掉。 */
function assertNoOverlap(periods: Period[], regionId: string) {
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
          `${regionId} track ${track}：時期重疊 — "${prev.name}"(…${prev.end}) 與 "${cur.name}"(${cur.start}…)。` +
            `請改用不同的 track。`,
        )
      }
    }
  }
}

export const REGIONS: Region[] = parse(regionSchema, regionsRaw, 'regions.yaml')
  .sort((a, b) => a.order - b.order)
  .map((meta) => {
    const periods = periodsByRegion.get(meta.id) ?? []
    const events = eventsByRegion.get(meta.id) ?? []
    assertUniqueIds(periods, `${meta.id}/periods.yaml`)
    assertUniqueIds(events, `${meta.id}/events.yaml`)
    assertNoOverlap(periods, meta.id)
    return {
      ...meta,
      periods,
      events: [...events].sort((a, b) => a.year - b.year),
      trackCount: Math.max(1, ...periods.map((p) => p.track + 1)),
    }
  })

assertUniqueIds(REGIONS, 'regions.yaml')
