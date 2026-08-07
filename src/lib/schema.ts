import { z } from 'zod'

/** 歷史紀年沒有西元 0 年：西元前 1 年的下一年就是西元 1 年。 */
const year = z
  .number()
  .int('年份必須是整數')
  .refine((y) => y !== 0, '沒有西元 0 年（-1 的下一年是 1）')

/**
 * 類別用單一漢字當作圖釘上的識別符號，而不是用顏色。
 * 六個類別散佈在畫布上屬於「任意兩色都可能相鄰」的情境，
 * 這種情況下沒有任何六色配色能同時通過色盲安全距離，所以識別交給文字。
 * 顏色只用來區分地區（兩個 slot），那是安全的。
 *
 * 每個主題可以有自己的一組類別（世界史是政治／戰爭…，鐵道史是通車／廢線…），
 * 所以實際的表在 `data.ts`，由當前主題的 `categories.yaml` 決定。
 * 這裡只定義它長什麼樣子。
 */
export const categorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /**
   * 圖釘上顯示的那一個字。**限一個字元** —— 圖釘是個小圓圈，
   * 兩個字就會擠到讀不出來。
   */
  glyph: z.string().length(1, 'glyph 必須剛好一個字'),
})

/**
 * 上限六個，理由同上：識別完全靠這個漢字，而漢字要能在圖釘裡讀得出來。
 * 想加第七類之前先想清楚 —— 顏色救不了你，那條路 CLAUDE.md 已經量過了。
 */
export const categoryListSchema = z
  .array(categorySchema)
  .min(1)
  .max(6, '類別最多六個（識別靠漢字圖釘，再多就讀不出來了）')

export type CategoryDef = z.infer<typeof categorySchema>

/**
 * 類別 id 是主題自訂的，所以型別只能是 string；
 * 合法性由 `data.ts` 的 `assertKnownCategory` 在載入期擋下。
 */
export type Category = string

/** 沒有 `categories.yaml` 的主題沿用這一組。 */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: 'politics', label: '政治', glyph: '政' },
  { id: 'war', label: '戰爭', glyph: '戰' },
  { id: 'culture', label: '文化', glyph: '文' },
  { id: 'science', label: '科技', glyph: '科' },
  { id: 'religion', label: '宗教', glyph: '教' },
  { id: 'economy', label: '經濟', glyph: '經' },
]

/**
 * 一個主題 = 一份獨立的資料集 + 一個網址（目錄名就是路徑）。
 *
 * `root: true` 的主題掛在根網址而不是 `/<目錄名>/`。恰好一個主題可以設，
 * 這是「哪個主題掛在根網址」的**唯一**來源 —— `vite.config.ts` 與
 * `data.ts` 都讀它，不要在程式裡另寫一個預設主題常數。
 */
export const topicSchema = z.object({
  /**
   * **只填主題名**（`世界史`、`台灣鐵道史`），不要帶站名。
   *
   * 站名由 `site.ts` 的 `SITE_NAME` 自動前綴：標題列的 h1 是 `AoE · 世界史`，
   * 主題切換清單裡則只印 `name` 本身。曾經 world 這份填 `AoE`、鐵道史那份填
   * `台灣鐵道史` —— 同一個欄位裝了兩種不同的東西，切換清單一並列就讀不通了。
   */
  name: z.string().min(1),
  /** 瀏覽器分頁的標題。沒填就是 `${SITE_NAME} · ${name}` */
  title: z.string().min(1).optional(),
  /** 標題列的副標，同時也是 HTML 的 meta description */
  description: z.string().min(1),
  /** 欄位在這個主題裡叫什麼（世界史是「地區」，鐵道史可能是「路線」） */
  columnLabel: z.string().min(1).default('地區'),
  /**
   * 工具列上的年代跳轉按鈕。
   *
   * **必須是主題設定，不能寫死也不該從範圍平均切**：世界史那組
   * （前2000／前1000／前500／1／500…）是刻意愈近代愈密的，因為資料密度就是那樣；
   * 而一個 1887–2026 的主題套上前2000 只會得到一排全部夾到軸頂的按鈕。
   *
   * 沒填就由 `scale.ts` 依範圍取整數級距自動產生，堪用但不會有上面那種調校。
   */
  jumps: z.array(year).optional(),
  /**
   * 開場的縮放（px/年）。沒填就取「整條軸大約兩屏」。
   *
   * 這是**密度問題的主要槓桿** —— 覺得畫面上圖釘太多、標題太少時要調的是它，
   * 不是 `minImportance()` 的門檻，也不是資料的 importance（CLAUDE.md 有實測）。
   */
  defaultPpy: z.number().positive().optional(),
  /**
   * 主題切換清單裡的排序。沒填的排在有填的後面，同組再依目錄名。
   *
   * 跟 `regionSchema` 的 `order` 同一個慣例：清單順序是編輯決定的，
   * 不該取決於目錄名的字母序（`tw-railway` 會排在 `world` 前面）。
   */
  order: z.number().optional(),
  root: z.boolean().optional(),
})

export type TopicMeta = z.infer<typeof topicSchema>

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
    /**
     * 類別 id，必須在當前主題的 `categories.yaml` 裡（沒有該檔就是預設六類）。
     * 這裡刻意只驗 string 而不用 `z.enum`：類別表是主題資料，
     * 要在 `data.ts` 讀完主題之後才知道 —— 寫成 enum 會讓 schema 反過來
     * 依賴 data，形成循環。錯誤訊息也是 `data.ts` 那道 guard 比較好讀，
     * 它會把可用的類別 id 全部列出來。
     */
    category: z.string().min(1),
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
    /**
     * 真實估計年代早於時間軸起點（`MIN_YEAR`）時使用。`year` 欄位一律維持
     * 夾住後的值（世界史目前是 -3000），縱軸位置的不變式不受影響 ——
     * `year` 只負責「畫在哪裡」，`actualYear` 只負責「文字寫什麼」，
     * 兩者分工不重疊。
     *
     * 只要填了，`scale.ts` 的 `displayYear()` 就會讓所有文字顯示
     * （圖釘、詳情面板、搜尋列）一律改印這個數字，`year` 不會出現在任何
     * 文字裡——同一則事件不會同時看到兩個不同的年份互相打架。
     *
     * 只在真的被時間軸起點截斷時才填。像龍山文化雖然也卡在 -3000，
     * 但那是它本來的分期就從西元前 3000 年算起，不是被截斷，就不該填這個欄位——
     * `data.ts` 的 `assertActualYearBeforeMinYear` 會擋住 `actualYear >= MIN_YEAR`
     * 這種填錯的情況。
     */
    actualYear: year.optional(),
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
 * 時間軸的上下界（`src/topics/<主題>/timeline.yaml`）。
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
