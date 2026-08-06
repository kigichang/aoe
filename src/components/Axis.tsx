import { memo } from 'react'
import { HAS_TRUNCATED_EVENTS } from '../lib/data'
import { fmtYear, MIN_YEAR, ticks, tickStep, totalHeight, yearToY } from '../lib/scale'

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
            <span className="tick-label">
              {/* 起點刻度不是歷史的真正起點，只是這條軸畫到哪裡為止 ——
                  有事件被截斷時加個 ~，提醒讀者更早的事還在，只是畫不下 */}
              {year === MIN_YEAR && HAS_TRUNCATED_EVENTS ? '~' : ''}
              {fmtYear(year)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const Axis = memo(AxisImpl)
