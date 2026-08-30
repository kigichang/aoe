import { useCallback, useEffect, useState } from 'react'
import { fmtYear } from '@web/lib/scale'
import type { HistEvent } from '@web/lib/schema'
import { api, gotoHit, refOf } from '../api'
import { LINK_KINDS, type EventHit, type EventLink, type Tag, type TagGroup } from '../types'
import { tagTree } from './tagTree'

/**
 * 掛在詳情面板（App 的 detailExtra）裡：這一則事件的 Tag 與關聯。
 * 出處之後、同時期之前 —— 先講「這一則自己的東西」，再講跨欄的對照。
 */
export function EventExtras({ event }: { event: HistEvent }) {
  const ref = refOf(event.id)
  return (
    <div className="extras">
      <TagsBlock eventRef={ref} title={event.title} />
      <LinksBlock eventRef={ref} />
    </div>
  )
}

/* ---------------- Tag ---------------- */

function TagsBlock({ eventRef, title }: { eventRef: string; title: string }) {
  const [all, setAll] = useState<{ tags: Tag[]; groups: TagGroup[] } | null>(null)
  const [mine, setMine] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [tags, groups, ids] = await Promise.all([api.listTags(), api.listTagGroups(), api.getEventTags(eventRef)])
    setAll({ tags, groups })
    setMine(ids)
  }, [eventRef])

  useEffect(() => {
    load().catch((e) => setError(String(e)))
  }, [load])

  const toggle = async (id: string) => {
    const next = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id]
    setMine(next)
    try {
      await api.setEventTags(eventRef, next, title)
      // 計數會變，重抓一次
      setAll({ tags: await api.listTags(), groups: all?.groups ?? [] })
    } catch (e) {
      setError(String(e))
    }
  }

  const quickAdd = async (name: string) => {
    const id = `tag-${crypto.randomUUID().slice(0, 8)}`
    try {
      await api.saveTag({ id, name, order: 0, count: 0 })
      await load()
      await toggle(id)
    } catch (e) {
      setError(String(e))
    }
  }

  if (!all) return null
  const byId = new Map(all.tags.map((t) => [t.id, t]))
  const chips = mine.map((id) => byId.get(id)).filter((t): t is Tag => !!t)

  return (
    <section className="extras-block">
      <h3>
        Tag
        <button type="button" className="views-act" onClick={() => setEditing((v) => !v)}>
          {editing ? '完成' : '編輯'}
        </button>
      </h3>
      {error && <p className="views-error">{error}</p>}
      {chips.length === 0 && !editing && <p className="views-sub">還沒有 tag。</p>}
      <div className="tag-chips">
        {chips.map((t) => (
          <span key={t.id} className="tag-chip" style={t.color ? { ['--tag' as string]: t.color } : undefined}>
            {t.name}
          </span>
        ))}
      </div>
      {editing && (
        <div className="tag-picker">
          {tagTree(all.tags, all.groups).map(({ group, nodes }) => (
            <div key={group?.id ?? '_'}>
              <h4>{group?.name ?? '未分組'}</h4>
              {nodes.map(({ tag, depth }) => (
                <label key={tag.id} className="views-check" style={{ paddingLeft: depth * 16 }}>
                  <input type="checkbox" checked={mine.includes(tag.id)} onChange={() => toggle(tag.id)} />
                  {tag.name}
                  <span className="views-sub">{tag.count}</span>
                </label>
              ))}
              {nodes.length === 0 && <p className="views-sub">（空）</p>}
            </div>
          ))}
          <form
            className="tag-quick"
            onSubmit={(e) => {
              e.preventDefault()
              const input = e.currentTarget.elements.namedItem('name') as HTMLInputElement
              const v = input.value.trim()
              if (v) quickAdd(v)
              input.value = ''
            }}
          >
            <input name="name" type="text" placeholder="新 tag 名稱（未分組）" />
            <button type="submit" className="views-act">
              ＋
            </button>
          </form>
        </div>
      )}
    </section>
  )
}

/* ---------------- 關聯 ---------------- */

function LinksBlock({ eventRef }: { eventRef: string }) {
  const [links, setLinks] = useState<EventLink[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => api.listLinks(eventRef).then(setLinks), [eventRef])
  useEffect(() => {
    load().catch((e) => setError(String(e)))
  }, [load])

  const remove = async (id: string) => {
    try {
      await api.deleteLink(id)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <section className="extras-block">
      <h3>
        關聯
        <button type="button" className="views-act" onClick={() => setAdding((v) => !v)}>
          {adding ? '取消' : '＋ 關聯'}
        </button>
      </h3>
      {error && <p className="views-error">{error}</p>}
      {links.length === 0 && !adding && <p className="views-sub">還沒有關聯。</p>}
      <ul className="link-list">
        {links.map((l) => {
          const outgoing = l.from.ref === eventRef
          const other = outgoing ? l.to : l.from
          return (
            <li key={l.id}>
              <span className="link-kind">{outgoing ? `${l.kind} →` : `← ${l.kind}`}</span>
              <button
                type="button"
                className={`link-target${other.orphan ? ' is-orphan' : ''}`}
                onClick={() => gotoHit(other)}
                disabled={other.orphan}
                title={other.orphan ? '這則事件已不存在（保留的是當時的標題）' : `${other.topicName}／${other.regionName}`}
              >
                {!other.orphan && <span className="c-year">{fmtYear(other.year)}</span>}
                <span className="c-title">{other.title}</span>
                {!other.orphan && <span className="views-sub">{other.topicName}</span>}
              </button>
              {l.note && <span className="link-note">{l.note}</span>}
              <button type="button" className="views-act" onClick={() => remove(l.id)} aria-label="刪除關聯">
                ✕
              </button>
            </li>
          )
        })}
      </ul>
      {adding && (
        <LinkForm
          fromRef={eventRef}
          onDone={() => {
            setAdding(false)
            load()
          }}
          onError={setError}
        />
      )}
    </section>
  )
}

function LinkForm({ fromRef, onDone, onError }: { fromRef: string; onDone: () => void; onError: (s: string) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<EventHit[]>([])
  const [target, setTarget] = useState<EventHit | null>(null)
  const [kind, setKind] = useState<string>(LINK_KINDS[0])
  const [reverse, setReverse] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (q.trim().length < 1) {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      api.searchEvents(q, 20).then(setHits).catch((e) => onError(String(e)))
    }, 150)
    return () => clearTimeout(t)
  }, [q, onError])

  const save = async () => {
    if (!target) return
    try {
      await api.saveLink({
        id: `link-${crypto.randomUUID().slice(0, 8)}`,
        fromRef: reverse ? target.ref : fromRef,
        toRef: reverse ? fromRef : target.ref,
        kind,
        note: note.trim() || undefined,
      })
      onDone()
    } catch (e) {
      onError(String(e))
    }
  }

  return (
    <div className="link-form">
      {!target ? (
        <>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋任何主題的事件標題…"
            autoFocus
          />
          <ul className="link-hits">
            {hits
              .filter((h) => h.ref !== fromRef)
              .map((h) => (
                <li key={h.ref}>
                  <button type="button" onClick={() => setTarget(h)}>
                    <span className="c-year">{fmtYear(h.year)}</span>
                    <span className="c-title">{h.title}</span>
                    <span className="views-sub">
                      {h.topicName}／{h.regionName}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <>
          <p className="link-picked">
            <span className="c-year">{fmtYear(target.year)}</span> {target.title}
            <button type="button" className="views-act" onClick={() => setTarget(null)}>
              換一則
            </button>
          </p>
          <div className="link-kind-row">
            <label className="views-check">
              <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
              方向相反（對方 → 這一則）
            </label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {LINK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="備註（選填）" />
            <button type="button" className="views-primary" onClick={save}>
              儲存
            </button>
          </div>
        </>
      )}
    </div>
  )
}
