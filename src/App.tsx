import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { REGIONS } from './lib/data'
import { CATEGORY_IDS, type Category } from './lib/schema'
import {
  MAX_YEAR,
  MIN_YEAR,
  clampPpy,
  fmtYear,
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
import { useTheme } from './lib/theme'

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

const ALL_EVENTS = REGIONS.flatMap((r, slot) =>
  r.events.map((e) => ({ event: e, region: r, slot })),
)

export default function App() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [ppy, setPpy] = useState(0.6)
  const [categories, setCategories] = useState(() => new Set<Category>(CATEGORY_IDS))
  const [showLegendary, setShowLegendary] = useState(true)
  const [visibleRegions, setVisibleRegions] = useState(
    () => new Set(REGIONS.map((r) => r.id)),
  )
  const [hoverYear, setHoverYear] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
      top: yearToY(year, ppyRef.current) + HEAD_H - el.clientHeight * 0.4,
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

  // 開場停在西元前後，一眼看到秦漢對上羅馬
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = yearToY(1, 0.6) + HEAD_H - el.clientHeight * 0.45
  }, [])

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
          <h1>AoE</h1>
          <p>把不同地區放在同一條時間軸上，看同一個年代各自在發生什麼。</p>
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>

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
      />

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
  )
}
