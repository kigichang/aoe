import { useEffect, useRef } from 'react'
import { CATEGORIES } from '../lib/data'
import type { HistEvent, Region } from '../lib/schema'
import { displayYear, fmtRange } from '../lib/scale'

interface Props {
  event: HistEvent
  region: Region
  slot: number
  /** 同一年前後，其他地區正在發生什麼 —— 這個網站的重點 */
  concurrent: { region: Region; slot: number; events: HistEvent[]; nearestIds: Set<string> }[]
  onClose: () => void
  onSelect: (id: string) => void
}

export function DetailPanel({ event, region, slot, concurrent, onClose, onSelect }: Props) {
  const detailRef = useRef<HTMLElement>(null)

  // 換一則事件時面板整個內容都變了，捲動位置卻是舊的 —— 尤其從「同時期」清單
  // 點下去時，使用者本來就捲到清單那段，不重置的話新事件的標題與描述會被卡在畫面外。
  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 })
  }, [event.id])

  return (
    <aside className="detail" aria-label="事件詳情" ref={detailRef}>
      <div className="detail-header">
        <button type="button" className="detail-close" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <div className={`detail-tag r${slot % 8}`}>
          <span className="glyph" aria-hidden="true">
            {CATEGORIES[event.category].glyph}
          </span>
          {region.name}・{CATEGORIES[event.category].label}
        </div>
        <h2>{event.title}</h2>
        <p className="detail-date">{fmtRange(displayYear(event), event.endYear)}</p>
      </div>

      <div className="detail-body">
        {event.desc && <p className="detail-desc">{event.desc}</p>}
        {event.links && (
          <p className="detail-links">
            {Object.entries(event.links).map(([name, url]) => (
              <a key={name} href={url} target="_blank" rel="noreferrer">
                {name}
              </a>
            ))}
          </p>
        )}

        {event.sources && (
          <div className="detail-sources">
            <h3>出處</h3>
            <ul>
              {event.sources.map((s) => (
                <li key={s.title}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {concurrent.length > 0 && (
          <div className="detail-concurrent">
            <h3>同時期</h3>
            {concurrent.map(({ region: r, slot: s, events, nearestIds }) => (
              <div key={r.id} className={`concurrent-group r${s % 8}`}>
                <h4>{r.name}</h4>
                <ul>
                  {events.map((e) => (
                    <li key={e.id} className={nearestIds.has(e.id) ? 'is-nearest' : undefined}>
                      <button type="button" onClick={() => onSelect(e.id)}>
                        <span className="c-year">{fmtRange(e.year)}</span>
                        <span className="c-title">{e.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
