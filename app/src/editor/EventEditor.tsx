import { useEffect, useRef, useState } from 'react'
import { CloseIcon } from '@web/components/icons'
import { fmtYear } from '@web/lib/scale'
import { api } from '../api'
import type { Placement, TopicCatalog, UserEvent } from '../types'

/**
 * 使用者事件的編輯器。一則事件可以放到多個主題的欄位上（placement），
 * 每個 placement 自己選類別 —— 各主題的類別表不同。
 *
 * 存檔後整頁重載（View 是 per-document 常數，見 bootstrap.ts）；
 * 網址的 #e= 會留著，重載後仍選中同一則。
 */

interface Props {
  /** 編輯既有事件時給 ref；新增時 undefined */
  editRef?: string
  /** 新增時預設放到哪一欄（例如「目前 View 的第一欄」） */
  initialPlacement?: { topic: string; region: string }
  onClose: () => void
}

const newRef = () => `user/${crypto.randomUUID()}`

export function EventEditor({ editRef, initialPlacement, onClose }: Props) {
  const [catalog, setCatalog] = useState<TopicCatalog[] | null>(null)
  const [ev, setEv] = useState<UserEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    ;(async () => {
      const c = await api.listTopicCatalog()
      setCatalog(c)
      if (editRef) {
        const e = await api.getUserEvent(editRef)
        if (!e) throw new Error(`找不到事件 ${editRef}`)
        setEv(e)
      } else {
        const t = c.find((x) => x.slug === initialPlacement?.topic) ?? c[0]
        const r = t.regions.find((x) => x.id === initialPlacement?.region) ?? t.regions[0]
        setEv({
          ref: newRef(),
          year: new Date().getFullYear(),
          title: '',
          importance: 3,
          legendary: false,
          sources: [],
          placements: [{ topic: t.slug, region: r.id, category: t.categories[0].id }],
        })
      }
    })().catch((e) => setError(String(e)))
  }, [editRef, initialPlacement])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async () => {
    if (!ev) return
    setBusy(true)
    setError(null)
    try {
      await api.saveUserEvent({
        ...ev,
        sources: ev.sources.filter((s) => s.title.trim() !== ''),
      })
      location.reload()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!ev || !editRef) return
    if (!confirm(`刪除「${ev.title}」？`)) return
    try {
      await api.deleteUserEvent(editRef)
      location.hash = ''
      location.reload()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help views-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <h2 id="event-editor-title">{editRef ? '編輯事件' : '新增事件'}</h2>
          <button type="button" className="help-close" onClick={onClose} ref={closeRef} aria-label="關閉">
            <CloseIcon />
          </button>
        </div>
        {error && <p className="views-error">{error}</p>}
        {!catalog || !ev ? (
          <p className="help-lead">載入中…</p>
        ) : (
          <form
            className="views-form"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <label className="views-field views-field-wide">
              <span>標題</span>
              <input
                type="text"
                value={ev.title}
                onChange={(e) => setEv({ ...ev, title: e.target.value })}
                autoFocus
                required
              />
            </label>

            <div className="views-range">
              <label className="views-field">
                <span>年份（西元前用負數）</span>
                <input
                  type="number"
                  value={ev.year}
                  onChange={(e) => setEv({ ...ev, year: Number(e.target.value) })}
                  required
                />
              </label>
              <label className="views-field">
                <span>結束年（選填）</span>
                <input
                  type="number"
                  value={ev.endYear ?? ''}
                  onChange={(e) =>
                    setEv({ ...ev, endYear: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </label>
              <label className="views-field">
                <span>
                  重要度
                  <span className="views-tip views-tip-end">
                    <button type="button" className="views-tip-btn" aria-label="重要度說明" aria-describedby="importance-tip">
                      ?
                    </button>
                    <span className="views-tip-body" id="importance-tip" role="tooltip">
                      {/* 一行寫完：JSX 跨行的文字會被接成一個半形空白，中文句號後面會多出一格 */}
                      決定事件在哪個縮放層級出現：5 全域視角就看得到，逐級放大才會釋出 4、3、2，1 要放到最大。同一欄給太多 5，縮小時就會擠成一團。
                    </span>
                  </span>
                </span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  step={1}
                  value={ev.importance}
                  onChange={(e) => {
                    // 一律夾在 1–5：清空欄位時 Number('') 會變 0，不夾住就會存進不合法的值
                    const n = Math.round(Number(e.target.value))
                    setEv({ ...ev, importance: Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : ev.importance })
                  }}
                  required
                />
              </label>
              <label className="views-check">
                <input
                  type="checkbox"
                  checked={ev.legendary}
                  onChange={(e) => setEv({ ...ev, legendary: e.target.checked })}
                />
                傳說（年代是後世追記）
              </label>
            </div>

            <label className="views-field views-field-wide">
              <span>描述（選填）</span>
              <textarea
                rows={4}
                value={ev.desc ?? ''}
                onChange={(e) => setEv({ ...ev, desc: e.target.value })}
              />
            </label>

            <h3>放到哪些欄位</h3>
            <PlacementList catalog={catalog} value={ev.placements} onChange={(p) => setEv({ ...ev, placements: p })} />

            <h3>出處（選填）</h3>
            <ul className="views-cols">
              {ev.sources.map((s, i) => (
                <li key={i}>
                  <input
                    type="text"
                    placeholder="標題，例：維基百科：某條目"
                    value={s.title}
                    onChange={(e) =>
                      setEv({ ...ev, sources: ev.sources.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })
                    }
                  />
                  <input
                    type="url"
                    placeholder="https://…（選填）"
                    value={s.url ?? ''}
                    onChange={(e) =>
                      setEv({
                        ...ev,
                        sources: ev.sources.map((x, k) =>
                          k === i ? { ...x, url: e.target.value === '' ? undefined : e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setEv({ ...ev, sources: ev.sources.filter((_, k) => k !== i) })}
                    aria-label="移除出處"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="views-act"
              onClick={() => setEv({ ...ev, sources: [...ev.sources, { title: '' }] })}
            >
              ＋ 出處
            </button>

            <div className="views-actions">
              {editRef && (
                <button type="button" className="views-danger" onClick={remove}>
                  刪除
                </button>
              )}
              <span className="views-spacer" />
              <button type="button" onClick={onClose}>
                取消
              </button>
              <button
                type="submit"
                className="views-primary"
                disabled={busy || ev.title.trim() === '' || ev.placements.length === 0}
              >
                儲存
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function PlacementList({
  catalog,
  value,
  onChange,
}: {
  catalog: TopicCatalog[]
  value: Placement[]
  onChange: (p: Placement[]) => void
}) {
  const topicOf = (slug: string) => catalog.find((t) => t.slug === slug) ?? catalog[0]
  const update = (i: number, patch: Partial<Placement>) => {
    const next = value.map((p, k) => {
      if (k !== i) return p
      const merged = { ...p, ...patch }
      // 換了主題就要重選欄位與類別（各主題的表不同）
      const t = topicOf(merged.topic)
      if (!t.regions.some((r) => r.id === merged.region)) merged.region = t.regions[0].id
      if (!t.categories.some((c) => c.id === merged.category)) merged.category = t.categories[0].id
      return merged
    })
    onChange(next)
  }
  const add = () => {
    const t = catalog[0]
    onChange([...value, { topic: t.slug, region: t.regions[0].id, category: t.categories[0].id }])
  }
  return (
    <>
      <ul className="views-cols">
        {value.map((p, i) => {
          const t = topicOf(p.topic)
          return (
            <li key={i}>
              <select value={p.topic} onChange={(e) => update(i, { topic: e.target.value })} aria-label="主題">
                {catalog.map((x) => (
                  <option key={x.slug} value={x.slug}>
                    {x.meta.name}
                  </option>
                ))}
              </select>
              <select value={p.region} onChange={(e) => update(i, { region: e.target.value })} aria-label="欄位">
                {t.regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <select value={p.category} onChange={(e) => update(i, { category: e.target.value })} aria-label="類別">
                {t.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.glyph} {c.label}
                  </option>
                ))}
              </select>
              <span className="views-sub">
                {fmtYear(t.timeline.minYear)} – {fmtYear(t.timeline.maxYear)}
              </span>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, k) => k !== i))}
                disabled={value.length === 1}
                aria-label="移除"
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" className="views-act" onClick={add}>
        ＋ 再放到另一個欄位
      </button>
      <p className="views-hint">年份必須落在每個所選主題的時間軸範圍內，否則存不進去（會被畫到畫布外）。</p>
    </>
  )
}
