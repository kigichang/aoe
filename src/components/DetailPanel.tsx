import { CATEGORIES, type HistEvent, type Region } from '../lib/schema'
import { fmtRange } from '../lib/scale'

interface Props {
  event: HistEvent
  region: Region
  slot: number
  /** 同一年前後，其他地區正在發生什麼 —— 這個網站的重點 */
  concurrent: { region: Region; slot: number; events: HistEvent[] }[]
  onClose: () => void
  onSelect: (id: string) => void
}

export function DetailPanel({ event, region, slot, concurrent, onClose, onSelect }: Props) {
  return (
    <aside className="detail" aria-label="事件詳情">
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
      <p className="detail-date">{fmtRange(event.year, event.endYear)}</p>
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
          {concurrent.map(({ region: r, slot: s, events }) => (
            <div key={r.id} className={`concurrent-group r${s % 8}`}>
              <h4>{r.name}</h4>
              <ul>
                {events.map((e) => (
                  <li key={e.id}>
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
    </aside>
  )
}
