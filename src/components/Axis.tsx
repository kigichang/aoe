import { memo } from 'react'
import { fmtYear, ticks, tickStep, totalHeight, yearToY } from '../lib/scale'

function AxisImpl({ ppy }: { ppy: number }) {
  const step = tickStep(ppy)
  return (
    <div className="lane axis-lane">
      <header className="lane-head">
        <span className="lane-name">年代</span>
        <span className="lane-sub">每格 {step} 年</span>
      </header>
      <div className="lane-body" style={{ height: totalHeight(ppy) }}>
        {ticks(ppy).map((year) => (
          <div key={year} className="tick" style={{ top: yearToY(year, ppy) }}>
            <span className="tick-label">{fmtYear(year)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const Axis = memo(AxisImpl)
