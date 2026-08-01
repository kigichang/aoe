import { memo, useMemo } from 'react'
import type { Category, Region } from '../lib/schema'
import { minImportance, totalHeight, yearToY } from '../lib/scale'
import { placeEvents } from '../lib/layout'
import { PeriodRail } from './PeriodRail'
import { EventMark } from './EventMark'

interface Props {
  region: Region
  slot: number
  ppy: number
  categories: Set<Category>
  showLegendary: boolean
  laneCount: number
  selectedId: string | null
  onSelect: (id: string) => void
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
}: Props) {
  const floor = minImportance(ppy)

  const placed = useMemo(() => {
    const visible = region.events.filter(
      (e) =>
        e.importance >= floor &&
        categories.has(e.category) &&
        (showLegendary || !e.legendary),
    )
    return placeEvents(visible, (year) => yearToY(year, ppy), laneCount, ppy)
  }, [region.events, floor, categories, showLegendary, ppy, laneCount])

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

  return (
    <div className={`lane region-lane r${slot % 8}`}>
      <header className="lane-head">
        {/* sticky-left：欄位捲到一半時名稱仍留在畫面上，才知道正在看哪一區 */}
        <div className="lane-head-name">
          <span className="lane-name">{region.name}</span>
          {region.subtitle && <span className="lane-sub">{region.subtitle}</span>}
        </div>
        <span className="lane-count">{placed.length} 則</span>
      </header>
      <div className="lane-body" style={{ height: totalHeight(ppy) }}>
        {tracks.map((periods, t) => (
          <PeriodRail key={t} periods={periods} ppy={ppy} />
        ))}
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
      </div>
    </div>
  )
}

export const RegionColumn = memo(RegionColumnImpl)
