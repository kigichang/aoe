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
  laneCount: number
  selectedId: string | null
  onSelect: (id: string) => void
}

function RegionColumnImpl({
  region,
  slot,
  ppy,
  categories,
  laneCount,
  selectedId,
  onSelect,
}: Props) {
  const floor = minImportance(ppy)

  const placed = useMemo(() => {
    const visible = region.events.filter(
      (e) => e.importance >= floor && categories.has(e.category),
    )
    return placeEvents(visible, (year) => yearToY(year, ppy), laneCount)
  }, [region.events, floor, categories, ppy, laneCount])

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
        <span className="lane-name">{region.name}</span>
        {region.subtitle && <span className="lane-sub">{region.subtitle}</span>}
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
