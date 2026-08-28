import { memo, useMemo } from 'react'
import type { Category, Region } from '../lib/schema'
import { minImportance, totalHeight, yearToY } from '../lib/scale'
import { placeEvents } from '../lib/layout'
import { PeriodRail } from './PeriodRail'
import { EventMark } from './EventMark'
import { CaretDownIcon } from './icons'

interface Props {
  region: Region
  slot: number
  ppy: number
  categories: Set<Category>
  showLegendary: boolean
  laneCount: number
  selectedId: string | null
  onSelect: (id: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

function RegionColumnImpl({
  region,
  slot,
  ppy,
  categories,
  showLegendary,
  laneCount,
  selectedId,
  onSelect,
  collapsed,
  onToggleCollapse,
}: Props) {
  const floor = minImportance(ppy)

  // 收合時只有事件不畫（斷代色帶照畫，見下面的 lane-body），所以連排版都不必跑。
  // 代價是沒有則數可報 —— 標題列因此在收合時不印那一格。
  const placed = useMemo(() => {
    if (collapsed) return []
    const visible = region.events.filter(
      (e) =>
        e.importance >= floor &&
        categories.has(e.category) &&
        (showLegendary || !e.legendary),
    )
    return placeEvents(visible, (year) => yearToY(year, ppy), laneCount, ppy)
  }, [region.events, floor, categories, showLegendary, ppy, laneCount, collapsed])

  const lanes = useMemo(
    () =>
      Array.from({ length: laneCount }, (_, i) => placed.filter((p) => p.lane === i)),
    [placed, laneCount],
  )

  const tracks = useMemo(
    () =>
      Array.from({ length: region.trackCount }, (_, t) =>
        region.periods.filter((p) => p.track === t),
      ),
    [region.periods, region.trackCount],
  )

  /*
   * 收合與展開共用同一份標題列，只差在「則數」與事件區畫不畫。
   *
   * 曾經讓收合狀態走另一棵樹（直書的標題、標題列不畫副標、body 整個空掉），
   * 那是錯的：直書的漢字要轉頭讀，掃過一排欄位時反而比橫書慢，而且收合後
   * 那一欄就完全不知道自己是誰的哪一段 —— 斷代色帶正是「這一欄現在在哪個
   * 時代」的答案，收合之後更需要它，不是更不需要。
   */
  return (
    <div className={`lane region-lane r${slot % 8}${collapsed ? ' is-collapsed' : ''}`}>
      <header className="lane-head">
        {/* sticky-left：欄位捲到一半時名稱仍留在畫面上，才知道正在看哪一區 */}
        <div className="lane-head-name">
          <span className="lane-name">{region.name}</span>
          {region.subtitle && <span className="lane-sub">{region.subtitle}</span>}
        </div>
        <div className="lane-head-actions">
          {/* 收合時不跑排版（見上面的 placed），沒有「畫了幾則」可以報 ——
              印「0 則」會是假的，不如不印 */}
          {!collapsed && <span className="lane-count">{placed.length} 則</span>}
          <button
            type="button"
            className={`lane-collapse-btn ${collapsed ? 'is-expand' : 'is-collapse'}`}
            onClick={onToggleCollapse}
            title={collapsed ? `展開「${region.name}」` : `收合「${region.name}」`}
            aria-label={collapsed ? `展開「${region.name}」` : `收合「${region.name}」`}
            aria-expanded={!collapsed}
          >
            <CaretDownIcon />
          </button>
        </div>
      </header>
      <div className="lane-body" style={{ height: totalHeight(ppy) }}>
        {/* 斷代色帶收合後照畫。它們靠左，跟展開時在欄內的 x 位置一樣，
            所以開關收合不會讓色帶在欄內左右跳。 */}
        {tracks.map((periods, t) => (
          <PeriodRail key={t} periods={periods} ppy={ppy} />
        ))}
        {!collapsed && (
          <div className="event-area">
            {lanes.map((laneEvents, i) => (
              <div key={i} className="event-lane">
                {laneEvents.map((p) => (
                  <EventMark
                    key={p.event.id}
                    placed={p}
                    ppy={ppy}
                    selected={p.event.id === selectedId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export const RegionColumn = memo(RegionColumnImpl)
