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

/**
 * 一筆出處。`url` 選填，因為書籍、論文這類來源沒有網址。
 *
 * 出處是給讀者查證用的指標，不是「可以照抄」的許可 ——
 * 維基百科的條目文字是 CC BY-SA（含相同方式分享），
 * 抄了整批資料就得跟著改授權。年代與事實本身不受著作權保護，
 * 所以本專案的做法是：查維基確認年代，`title` 與 `desc` 一律自行撰寫。
 */
export const sourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().optional(),
})

export const eventSchema = z
  .object({
    id: z.string().min(1),
    year,
    endYear: year.optional(),
    title: z.string().min(1),
    category: z.enum(CATEGORY_IDS as [Category, ...Category[]]),
    importance: z.number().int().min(1).max(5),
    desc: z.string().optional(),
    /**
     * 傳說／神話，年代是後世追記而非考古定年（三皇五帝、神武天皇、羅馬建城）。
     *
     * 刻意不做成第七個 category：`category` 答的是「這是哪一種事」，
     * `legendary` 答的是「這件事有多確定」，兩個軸。伏羲畫八卦是 culture、
     * 黃帝敗蚩尤是 war、大禹治水是 economy —— 全塞進「神話」就把這層丟掉了，
     * 而「神農教民耕種 vs 張騫通西域」正是這個網站要提供的比較。
     *
     * 另外「神話」是史學立場（等於斷言虛構），「傳說」才是中性說法。
     *
     * 這個旗標必須改變圖釘**怎麼畫**（虛線、半透明），不能只在詳情面板加註記 ——
     * 圖釘畫在精確的 y 上，本身就是在宣稱一個資料撐不起的精度。
     */
    legendary: z.boolean().optional(),
    /** 這筆資料的依據，供讀者查證 */
    sources: z.array(sourceSchema).min(1).optional(),
    /** 延伸閱讀。跟 sources 語意不同，UI 也分開呈現 */
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

/**
 * 時間軸的上下界（`src/data/timeline.yaml`）。
 * 曾經寫死在 `scale.ts` 裡，問題是超出範圍的資料會被畫到畫布外面 ——
 * 不報錯、主控台乾淨，只是讀者永遠看不到那一筆。範圍改成資料之後，
 * `data.ts` 的 `assertInRange` 才有東西可以比對。
 */
export const timelineSchema = z
  .object({
    minYear: year,
    maxYear: year,
  })
  .refine((t) => t.maxYear > t.minYear, { message: 'maxYear 必須大於 minYear' })

export const regionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  subtitle: z.string().optional(),
  order: z.number().int().min(0),
})

export type HistEvent = z.infer<typeof eventSchema>
export type Period = z.infer<typeof periodSchema>
export type RegionMeta = z.infer<typeof regionSchema>
export type Timeline = z.infer<typeof timelineSchema>

export interface Region extends RegionMeta {
  periods: Period[]
  events: HistEvent[]
  /** 時期共有幾條 track（欄位內要畫幾條背景色帶） */
  trackCount: number
}
