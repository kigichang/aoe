import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CATEGORY_IDS, REGIONS, TOPIC } from './lib/data'
import type { Category } from './lib/schema'
import {
  MAX_YEAR,
  MIN_YEAR,
  clampPpy,
  defaultPpy,
  fmtYear,
  ppyForImportance,
  ticks,
  totalHeight,
  yToYear,
  yearToY,
} from './lib/scale'
import { Axis } from './components/Axis'
import { RegionColumn } from './components/RegionColumn'
import { Toolbar } from './components/Toolbar'
import { DetailPanel } from './components/DetailPanel'
import { ThemeToggle } from './components/ThemeToggle'
import { HelpOverlay } from './components/HelpOverlay'
import { SearchBox } from './components/SearchBox'
import { useTheme } from './lib/theme'
import { readUrlState, writeUrlState } from './lib/urlState'

/** 欄位標題列的高度，必須跟 CSS 的 --head-h 一致 */
const HEAD_H = 58
/** 年代軸的寬度，必須跟 CSS 的 --axis-w 一致 */
const AXIS_W = 88
/** 一個地區欄至少要這麼寬。低於這個寬度標題會被切到讀不懂，寧可讓畫布橫向捲動 */
const MIN_COL_W = 340
/** 一個標籤欄至少要這麼寬，事件標題才不會被切掉 */
const MIN_LANE_W = 340
/** 標籤欄再多下去，視線得之字形來回掃，反而比偶爾退化成圖釘更難讀 */
const MAX_LANES = 2
/** 「同時期」清單往前後各看多少年 */
const CONCURRENT_WINDOW = 60
/**
 * 「目前在看哪一年」取視窗高度的這個比例處。
 * 跳年代、開場定位、網址讀寫**必須用同一個值** —— 不然分享出去的連結
 * 打開之後位置會偏掉，而且偏多少還跟視窗高度有關。
 */
const VIEW_ANCHOR = 0.4

/** 只在載入時讀一次；之後網址由這支程式自己寫，不再回頭讀 */
const INITIAL_URL = readUrlState()

const ALL_EVENTS = REGIONS.flatMap((r, slot) =>
  r.events.map((e) => ({ event: e, region: r, slot })),
)

export default function App() {
  const scrollRef = useRef<HTMLDivElement>(null)
  /*
   * 開場縮放，由主題的 defaultPpy 決定（沒填就取整條軸約兩屏）。
   *
   * 世界史那份填的 1.0 是量出來的：門檻邏輯不動（<1.2 都是重要度 4+，同樣 226 則），
   * 但 0.6 時有一半的事件擠不下標籤、只剩圓點，1.0 降到 31%。
   * 讀得到的標題 112 → 155，台灣 9 → 14。
   * 代價是一屏從 1167 年變 700 年 —— 仍看得到「秦漢對上羅馬」。
   *
   * 密度問題的槓桿是這裡，不是 minImportance() 的門檻：實測把預設門檻
   * 調嚴到 5+，圖釘比例雖然降到 30%，讀得到的標題卻從 112 掉到 64。
   * 圖釘「比例」是會騙人的指標，分母跟著變 —— 要看的是讀得到幾則。
   */
  const [ppy, setPpy] = useState(() => INITIAL_URL.ppy ?? defaultPpy(TOPIC.defaultPpy))
  const [categories, setCategories] = useState(() => new Set<Category>(CATEGORY_IDS))
  const [showLegendary, setShowLegendary] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)
  const [visibleRegions, setVisibleRegions] = useState(
    () => new Set(REGIONS.map((r) => r.id)),
  )
  const [hoverYear, setHoverYear] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(INITIAL_URL.eventId)
  const { theme, toggle: toggleTheme } = useTheme()

  // 縮放時要固定住指標所指的那一年，否則畫面會亂跳
  const anchorRef = useRef<{ year: number; offset: number } | null>(null)

  useLayoutEffect(() => {
    const el = scrollRef.current
    const anchor = anchorRef.current
    if (!el || !anchor) return
    el.scrollTop = yearToY(anchor.year, ppy) + HEAD_H - anchor.offset
    anchorRef.current = null
  }, [ppy])

  const zoomAt = useCallback((factor: number, viewportOffset: number) => {
    const el = scrollRef.current
    if (!el) return
    setPpy((prev) => {
      const next = clampPpy(prev * factor)
      if (next === prev) return prev
      const contentY = el.scrollTop + viewportOffset - HEAD_H
      anchorRef.current = { year: yToYear(contentY, prev), offset: viewportOffset }
      return next
    })
  }, [])

  // 讓 scrollToYear 能保持穩定的 identity，又讀得到最新的 ppy
  const ppyRef = useRef(ppy)
  ppyRef.current = ppy

  const scrollToYear = useCallback((year: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({
      top: yearToY(year, ppyRef.current) + HEAD_H - el.clientHeight * VIEW_ANCHOR,
      behavior: 'smooth',
    })
  }, [])

  // React 的 onWheel 是 passive 的，攔不到 ctrl+wheel，只能自己掛
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  /**
   * slot 一律沿用地區在 REGIONS 裡的原始索引，不是篩選後的名次 ——
   * 顏色跟著地區走，關掉一欄不該讓剩下的欄換色。
   */
  const shownRegions = useMemo(
    () =>
      REGIONS.map((region, slot) => ({ region, slot })).filter((x) =>
        visibleRegions.has(x.region.id),
      ),
    [visibleRegions],
  )

  const regionChips = useMemo(
    () =>
      REGIONS.map((region, slot) => ({
        region,
        slot,
        visible: visibleRegions.has(region.id),
      })),
    [visibleRegions],
  )

  // 量捲動容器而不是 window，才拿得到扣掉捲軸後的真實可用寬度
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /**
   * 地區欄不再硬擠進一個畫面。地區少時平分寬度，多到擠不下就讓畫布橫向捲動，
   * 每欄保住 MIN_COL_W。畫布寬度在這裡算好、直接寫進 .lanes，
   * 格線與時間游標（inset-inline: 0）才會跨滿整個可捲動寬度而不是只有一個畫面。
   */
  const { canvasWidth, columnWidth } = useMemo(() => {
    const count = Math.max(1, shownRegions.length)
    const width = Math.max(viewportWidth, AXIS_W + count * MIN_COL_W)
    return { canvasWidth: width, columnWidth: (width - AXIS_W) / count }
  }, [viewportWidth, shownRegions.length])

  // 欄位夠寬就把標籤排成兩欄。單欄放不下時標籤會被往下推，
  // 推擠一累積就會讓事件順序看起來是錯的，多開一欄比縮小位移上限有效得多。
  const laneCount = Math.min(MAX_LANES, Math.max(1, Math.floor(columnWidth / MIN_LANE_W)))

  // 網址帶了年份就聽網址的；否則開場停在西元前後，一眼看到秦漢對上羅馬
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const year = INITIAL_URL.year ?? 1
    el.scrollTop = yearToY(year, ppyRef.current) + HEAD_H - el.clientHeight * VIEW_ANCHOR
  }, [])

  // syncUrl 要讀得到最新的選取，但自己的 identity 必須穩定
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const syncUrl = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const contentY = el.scrollTop - HEAD_H + el.clientHeight * VIEW_ANCHOR
    writeUrlState({
      year: yToYear(contentY, ppyRef.current),
      ppy: ppyRef.current,
      eventId: selectedIdRef.current,
    })
  }, [])

  /*
   * 捲動時更新網址。**必須 debounce** —— 捲動事件一秒可以觸發數十次，
   * 每次都呼叫 history.replaceState 會拖慢捲動，Safari 還會直接丟出
   * 「呼叫太頻繁」的警告。
   *
   * 副作用是開場的程式化捲動也會觸發一次，所以網址在載入後約 0.25 秒
   * 就會補上 #y=…&z=…。這是刻意接受的：網址永遠反映現況，
   * 「複製網址列」才會一直是可靠的分享方式。
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let timer: number | undefined
    const onScroll = () => {
      clearTimeout(timer)
      timer = window.setTimeout(syncUrl, 250)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [syncUrl])

  // 縮放與選取是離散動作，不需要 debounce
  useEffect(() => {
    syncUrl()
  }, [ppy, selectedId, syncUrl])

  /*
   * 外部改動 hash（貼上別人分享的連結、手動編輯網址）時要跟著跳。
   * 自己寫入用的是 replaceState，不會觸發 hashchange，所以不會打架。
   */
  useEffect(() => {
    const onHashChange = () => {
      const el = scrollRef.current
      const next = readUrlState()
      if (!el) return
      setSelectedId(next.eventId)
      const nextPpy = next.ppy ?? ppyRef.current
      const year = next.year ?? yToYear(el.scrollTop - HEAD_H + el.clientHeight * VIEW_ANCHOR, ppyRef.current)
      if (nextPpy !== ppyRef.current) {
        // 借用縮放錨定：先記下要對齊的年份，ppy 更新後由 layout effect 定位
        anchorRef.current = { year, offset: el.clientHeight * VIEW_ANCHOR }
        setPpy(nextPpy)
      } else {
        el.scrollTop = yearToY(year, nextPpy) + HEAD_H - el.clientHeight * VIEW_ANCHOR
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  /**
   * 搜尋跳轉。**跳之前得先確保那則事件真的畫得出來** ——
   * 重要度低於當前層級、地區或類別被關掉、傳說被關掉，
   * 任何一項成立都會讓使用者跳過去只看到一片空白，
   * 而且畫面上完全沒有線索說明為什麼。
   */
  const revealEvent = useCallback(
    (id: string) => {
      const found = ALL_EVENTS.find((x) => x.event.id === id)
      const el = scrollRef.current
      if (!found || !el) return
      const { event, region } = found

      setVisibleRegions((prev) => (prev.has(region.id) ? prev : new Set(prev).add(region.id)))
      setCategories((prev) => (prev.has(event.category) ? prev : new Set(prev).add(event.category)))
      if (event.legendary) setShowLegendary(true)

      const needed = ppyForImportance(event.importance)
      if (needed > ppyRef.current) {
        // 借用縮放錨定：ppy 更新後由 layout effect 把該年份對到視窗錨點
        anchorRef.current = { year: event.year, offset: el.clientHeight * VIEW_ANCHOR }
        setPpy(needed)
      } else {
        scrollToYear(event.year)
      }
      setSelectedId(id)
    },
    [scrollToYear],
  )

  const onPointerMove = (e: React.MouseEvent) => {
    const el = scrollRef.current
    if (!el) return
    const contentY = el.scrollTop + (e.clientY - el.getBoundingClientRect().top) - HEAD_H
    const year = Math.round(yToYear(contentY, ppy))
    setHoverYear(contentY < 0 || year < MIN_YEAR || year > MAX_YEAR ? null : year)
  }

  const toggleRegion = useCallback((id: string) => {
    setVisibleRegions((prev) => {
      const next = new Set(prev)
      // 全部關掉等於整個畫面空白，所以最後一個不給關
      if (next.has(id) && next.size > 1) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleCategory = useCallback((c: Category) => {
    setCategories((prev) => {
      const next = new Set(prev)
      // 全部關掉等於什麼都看不到，所以最後一個不給關
      if (next.has(c) && next.size > 1) next.delete(c)
      else next.add(c)
      return next
    })
  }, [])

  // 選中的事件所屬地區被關掉時，詳情面板就跟著收起來
  const selected = useMemo(() => {
    const hit = ALL_EVENTS.find((x) => x.event.id === selectedId)
    return hit && visibleRegions.has(hit.region.id) ? hit : null
  }, [selectedId, visibleRegions])

  const concurrent = useMemo(() => {
    if (!selected) return []
    const { year } = selected.event
    return shownRegions
      .map(({ region, slot }) => ({
        region,
        slot,
        events: region.events.filter(
          (e) => e.id !== selected.event.id && Math.abs(e.year - year) <= CONCURRENT_WINDOW,
        ),
      }))
      .filter((g) => g.events.length > 0)
  }, [selected, shownRegions])

  const gridTicks = useMemo(() => ticks(ppy), [ppy])

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>{TOPIC.name}</h1>
          <p>{TOPIC.description}</p>
        </div>
        <div className="masthead-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setHelpOpen(true)}
            title="怎麼讀這張圖"
            aria-label="怎麼讀這張圖"
          >
            <span aria-hidden="true">？</span>
            <span>說明</span>
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}

      <Toolbar
        ppy={ppy}
        regions={regionChips}
        onToggleRegion={toggleRegion}
        categories={categories}
        showLegendary={showLegendary}
        onToggleLegendary={() => setShowLegendary((v) => !v)}
        onToggleCategory={toggleCategory}
        onZoom={(f) => zoomAt(f, (scrollRef.current?.clientHeight ?? 0) / 2)}
        onJump={scrollToYear}
        search={<SearchBox all={ALL_EVENTS} onPick={revealEvent} />}
      />

      {/* 捲動區與詳情面板並排：面板是版面的一部分，不是浮在上面的東西 */}
      <div className="workspace">
        <div
          className="scroller"
          ref={scrollRef}
          onMouseMove={onPointerMove}
          onMouseLeave={() => setHoverYear(null)}
        >
          <div
            className="lanes"
            style={{ height: totalHeight(ppy) + HEAD_H, width: canvasWidth }}
          >
            <div className="gridlines" style={{ top: HEAD_H }} aria-hidden="true">
              {gridTicks.map((year) => (
                <div key={year} className="gridline" style={{ top: yearToY(year, ppy) }} />
              ))}
            </div>

            <Axis ppy={ppy} />
            {shownRegions.map(({ region, slot }) => (
              <RegionColumn
                key={region.id}
                region={region}
                slot={slot}
                ppy={ppy}
                categories={categories}
                showLegendary={showLegendary}
                laneCount={laneCount}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ))}

            {/* 跟著游標的時間橫線 —— 「同時期」這件事就是靠它讀出來的 */}
            {hoverYear !== null && (
              <div
                className="time-cursor"
                style={{ top: yearToY(hoverYear, ppy) + HEAD_H }}
                aria-hidden="true"
              >
                <span className="time-cursor-chip">{fmtYear(hoverYear)}</span>
              </div>
            )}
          </div>
        </div>

        {selected && (
          <DetailPanel
            event={selected.event}
            region={selected.region}
            slot={selected.slot}
            concurrent={concurrent}
            onClose={() => setSelectedId(null)}
            onSelect={setSelectedId}
          />
        )}
      </div>
    </div>
  )
}
