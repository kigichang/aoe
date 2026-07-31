import { z } from 'zod'

/**
 * 類別用單一漢字當作圖釘上的識別符號，而不是用顏色。
 * 六個類別散佈在畫布上屬於「任意兩色都可能相鄰」的情境，
 * 這種情況下沒有任何六色配色能同時通過色盲安全距離，所以識別交給文字。
 * 顏色只用來區分地區（兩個 slot），那是安全的。
 */
export const CATEGORIES = {
  politics: { label: '政治', glyph: '政' },
  war: { label: '戰爭', glyph: '戰' },
  culture: { label: '文化', glyph: '文' },
  science: { label: '科技', glyph: '科' },
  religion: { label: '宗教', glyph: '教' },
  economy: { label: '經濟', glyph: '經' },
} as const

export type Category = keyof typeof CATEGORIES
export const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[]

/** 歷史紀年沒有西元 0 年：西元前 1 年的下一年就是西元 1 年。 */
const year = z
  .number()
  .int('年份必須是整數')
  .refine((y) => y !== 0, '沒有西元 0 年（-1 的下一年是 1）')

export const eventSchema = z
  .object({
    id: z.string().min(1),
    year,
    endYear: year.optional(),
    title: z.string().min(1),
    category: z.enum(CATEGORY_IDS as [Category, ...Category[]]),
    importance: z.number().int().min(1).max(5),
    desc: z.string().optional(),
    links: z.record(z.string(), z.string().url()).optional(),
  })
  .refine((e) => e.endYear === undefined || e.endYear >= e.year, {
    message: 'endYear 不能早於 year',
  })

export const periodSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    track: z.number().int().min(0).default(0),
    start: year,
    end: year,
    note: z.string().optional(),
  })
  .refine((p) => p.end >= p.start, { message: 'end 不能早於 start' })

export const regionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  subtitle: z.string().optional(),
  order: z.number().int().min(0),
})

export type HistEvent = z.infer<typeof eventSchema>
export type Period = z.infer<typeof periodSchema>
export type RegionMeta = z.infer<typeof regionSchema>

export interface Region extends RegionMeta {
  periods: Period[]
  events: HistEvent[]
  /** 時期共有幾條 track（欄位內要畫幾條背景色帶） */
  trackCount: number
}
