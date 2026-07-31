import { memo } from 'react'
import type { Period } from '../lib/schema'
import { yearToY, fmtRange } from '../lib/scale'

/** 色帶高度低於這個值就不畫字，否則會變成一團糊掉的墨點 */
const MIN_LABEL_HEIGHT = 44

interface Props {
  periods: Period[]
  ppy: number
}

/** 朝代／時期 = 欄位左側的背景色帶。事件是點，時期是面，兩者不該混在一起畫。 */
function PeriodRailImpl({ periods, ppy }: Props) {
  return (
    <div className="period-rail">
      {periods.map((p) => {
        const top = yearToY(p.start, ppy)
        // end 是含端點的，所以要涵蓋到 end 那一年的整年
        const height = yearToY(p.end + 1, ppy) - top
        return (
          <div
            key={p.id}
            className="period"
            style={{ top, height }}
            title={`${p.name}　${fmtRange(p.start, p.end)}${p.note ? `\n${p.note}` : ''}`}
          >
            {height >= MIN_LABEL_HEIGHT && <span className="period-name">{p.name}</span>}
          </div>
        )
      })}
    </div>
  )
}

export const PeriodRail = memo(PeriodRailImpl)
