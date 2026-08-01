import { CATEGORIES } from '../lib/schema'
import { fmtYear, yearToY } from '../lib/scale'
import type { PlacedEvent } from '../lib/layout'

/** 圖釘中心距離事件欄左緣的距離，引線要對齊到這裡 */
const RAIL_X = 11
/** 標籤列高度的一半。y / labelY 都是「中心」，排版時要扣掉才不會整體下移半列 */
const HALF_ROW = 11

interface Props {
  placed: PlacedEvent
  ppy: number
  selected: boolean
  onSelect: (id: string) => void
}

export function EventMark({ placed, ppy, selected, onSelect }: Props) {
  const { event, y, labelY, dotOnly } = placed
  const cat = CATEGORIES[event.category]
  const shifted = labelY - y > 2
  // 傳說事件的年份是後世追記的，畫成虛線半透明，讓人不必點開就看得出來
  const soft = event.legendary ? ' is-legendary' : ''

  // 只畫圖釘：標籤被擠掉了，但年份位置還是要標出來
  if (dotOnly) {
    return (
      <button
        type="button"
        className={`mark mark-dot-only${soft}`}
        // 同 layout.ts 的理由：畫布頂端的圖釘也是以中心定位，不夾住會露一半
        style={{ top: Math.max(0, y - 3.5) }}
        onClick={() => onSelect(event.id)}
        title={`${fmtYear(event.year)}　${event.title}`}
        aria-label={`${fmtYear(event.year)} ${event.title}`}
      />
    )
  }

  return (
    <>
      {shifted && (
        // 標籤被往下推開時，用一條引線接回真實年份，避免讀者看錯時間點
        <div className={`leader${soft}`} style={{ top: y, height: labelY - y, left: RAIL_X }} />
      )}
      {event.endYear !== undefined && (
        <div
          className="span"
          style={{ top: y, height: Math.max(2, yearToY(event.endYear, ppy) - y), left: RAIL_X }}
        />
      )}
      <button
        type="button"
        className={`mark imp-${event.importance}${selected ? ' is-selected' : ''}${soft}`}
        style={{ top: labelY - HALF_ROW }}
        onClick={() => onSelect(event.id)}
        aria-current={selected || undefined}
      >
        <span className="glyph" aria-hidden="true">
          {cat.glyph}
        </span>
        <span className="mark-year">{fmtYear(event.year)}</span>
        <span className="mark-title">{event.title}</span>
        <span className="sr-only">
          （{cat.label}
          {event.legendary ? '，傳說年代' : ''}）
        </span>
      </button>
    </>
  )
}
