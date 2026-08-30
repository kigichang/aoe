import { useCallback, useEffect, useRef, useState } from 'react'
import { fmtYear } from '@web/lib/scale'
import { CloseIcon } from '@web/components/icons'
import { api, openView } from '../api'
import type { TopicCatalog, View, ViewColumn } from '../types'

/**
 * 「組合視圖」：列出使用者建的 View，並提供編輯器。
 *
 * 對話框的殼直接用網站的 `.help-backdrop`／`.help` 樣式，Esc 的處理也照
 * HelpOverlay 的協定：`preventDefault()` 標記已消費，詳情面板才不會跟著關。
 *
 * 存檔後整頁重載到 `?view=<id>`——View 是 per-document 常數（見 bootstrap.ts），
 * 不在這裡試圖即時切換。
 */

/** 超過這個欄數，相鄰配色沒驗證過（CLAUDE.md「顏色只承載地區」那節） */
const VERIFIED_COLUMNS = 4

interface Props {
  /** 目前載入的 View；是使用者的就可以直接編輯 */
  currentId: string
  onClose: () => void
}

const newId = () => `v-${crypto.randomUUID().slice(0, 8)}`

function emptyView(catalog: TopicCatalog[]): View {
  const min = Math.min(...catalog.map((t) => t.timeline.minYear))
  const max = Math.max(...catalog.map((t) => t.timeline.maxYear))
  return { id: newId(), name: '', minYear: min, maxYear: max, builtin: false, columns: [] }
}

export function ViewsOverlay({ currentId, onClose }: Props) {
  const [catalog, setCatalog] = useState<TopicCatalog[] | null>(null)
  const [views, setViews] = useState<View[]>([])
  const [editing, setEditing] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const reload = useCallback(async () => {
    const [c, v] = await Promise.all([api.listTopicCatalog(), api.listViews()])
    setCatalog(c)
    setViews(v.filter((x) => !x.builtin))
  }, [])

  useEffect(() => {
    reload().catch((e) => setError(String(e)))
  }, [reload])

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

  const save = async (v: View) => {
    setError(null)
    try {
      await api.saveView(v)
      openView(v.id)
    } catch (e) {
      setError(String(e))
    }
  }

  const remove = async (v: View) => {
    if (!confirm(`刪除組合「${v.name}」？`)) return
    try {
      await api.deleteView(v.id)
      if (v.id === currentId) openView('')
      else await reload()
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
        aria-labelledby="views-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <h2 id="views-title">{editing ? (views.some((v) => v.id === editing.id) ? '編輯組合' : '新的組合') : '組合視圖'}</h2>
          <button type="button" className="help-close" onClick={onClose} ref={closeRef} aria-label="關閉">
            <CloseIcon />
          </button>
        </div>

        {error && <p className="views-error">{error}</p>}

        {!catalog ? (
          <p className="help-lead">載入中…</p>
        ) : editing ? (
          <ViewEditor
            catalog={catalog}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        ) : (
          <>
            <p className="help-lead">
              把不同主題的欄位放到同一條時間軸上並排。每個組合是獨立的一頁，
              存檔後會直接開啟。
            </p>
            <ul className="views-list">
              {views.map((v) => (
                <li key={v.id} className={v.id === currentId ? 'is-current' : undefined}>
                  <button type="button" className="views-open" onClick={() => openView(v.id)}>
                    <span className="views-name">{v.name}</span>
                    <span className="views-sub">
                      {fmtYear(v.minYear)} – {fmtYear(v.maxYear)}・{v.columns.length} 欄
                    </span>
                  </button>
                  <button type="button" className="views-act" onClick={() => setEditing(v)}>
                    編輯
                  </button>
                  <button type="button" className="views-act" onClick={() => remove(v)}>
                    刪除
                  </button>
                </li>
              ))}
              {views.length === 0 && <li className="views-empty">還沒有任何組合。</li>}
            </ul>
            <div className="views-actions">
              <button type="button" className="views-primary" onClick={() => setEditing(emptyView(catalog))}>
                新的組合
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface EditorProps {
  catalog: TopicCatalog[]
  initial: View
  onCancel: () => void
  onSave: (v: View) => void
}

function ViewEditor({ catalog, initial, onCancel, onSave }: EditorProps) {
  const [view, setView] = useState<View>(initial)
  const cols = view.columns
  const key = (c: ViewColumn) => `${c.topic}/${c.region}`
  const has = (topic: string, region: string) => cols.some((c) => c.topic === topic && c.region === region)

  const toggle = (topic: string, region: string) => {
    setView((v) => ({
      ...v,
      columns: has(topic, region)
        ? v.columns.filter((c) => !(c.topic === topic && c.region === region))
        : [...v.columns, { topic, region, importanceOffset: 0 }],
    }))
  }
  const move = (i: number, d: -1 | 1) => {
    setView((v) => {
      const next = [...v.columns]
      const j = i + d
      if (j < 0 || j >= next.length) return v
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...v, columns: next }
    })
  }
  const setOffset = (i: number, off: number) =>
    setView((v) => ({
      ...v,
      columns: v.columns.map((c, k) => (k === i ? { ...c, importanceOffset: off } : c)),
    }))

  /** 已選欄位的主題時間軸聯集，給「重設範圍」用 */
  const union = () => {
    const ts = catalog.filter((t) => cols.some((c) => c.topic === t.slug))
    if (ts.length === 0) return null
    return {
      minYear: Math.min(...ts.map((t) => t.timeline.minYear)),
      maxYear: Math.max(...ts.map((t) => t.timeline.maxYear)),
    }
  }

  const topicName = (slug: string) => catalog.find((t) => t.slug === slug)?.meta.name ?? slug
  const regionName = (slug: string, id: string) =>
    catalog.find((t) => t.slug === slug)?.regions.find((r) => r.id === id)?.name ?? id

  const valid = view.name.trim() !== '' && cols.length > 0 && view.maxYear > view.minYear

  return (
    <form
      className="views-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave({ ...view, name: view.name.trim() })
      }}
    >
      <label className="views-field">
        <span>名稱</span>
        <input
          type="text"
          value={view.name}
          onChange={(e) => setView({ ...view, name: e.target.value })}
          placeholder="例：中國 × 物理 × 音樂"
          autoFocus
        />
      </label>

      <h3>欄位（左到右）</h3>
      {cols.length > VERIFIED_COLUMNS && (
        <p className="views-warn">超過 {VERIFIED_COLUMNS} 欄，相鄰欄的配色沒驗證過，色盲讀者可能分不開。</p>
      )}
      <ol className="views-cols">
        {cols.map((c, i) => (
          <li key={key(c)} className={`r${i % 8}`}>
            <span className="swatch" aria-hidden="true" />
            <span className="views-col-name">
              {topicName(c.topic)}／{regionName(c.topic, c.region)}
            </span>
            <label className="views-offset" title="這一欄的重要度加減（各主題尺規不同時用）">
              重要度
              <select value={c.importanceOffset} onChange={(e) => setOffset(i, Number(e.target.value))}>
                {[-2, -1, 0, 1, 2].map((o) => (
                  <option key={o} value={o}>
                    {o > 0 ? `+${o}` : o}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="往左">
              ←
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === cols.length - 1} aria-label="往右">
              →
            </button>
            <button type="button" onClick={() => toggle(c.topic, c.region)} aria-label="移除">
              ✕
            </button>
          </li>
        ))}
        {cols.length === 0 && <li className="views-empty">從下面勾選欄位。</li>}
      </ol>

      <div className="views-catalog">
        {catalog.map((t) => (
          <fieldset key={t.slug}>
            <legend>
              {t.meta.name}
              <span className="views-sub">
                {fmtYear(t.timeline.minYear)} – {fmtYear(t.timeline.maxYear)}・{t.meta.columnLabel}
              </span>
            </legend>
            {t.regions.map((r) => (
              <label key={r.id} className="views-check">
                <input type="checkbox" checked={has(t.slug, r.id)} onChange={() => toggle(t.slug, r.id)} />
                {r.name}
                {r.subtitle && <span className="views-sub">{r.subtitle}</span>}
              </label>
            ))}
          </fieldset>
        ))}
      </div>

      <h3>時間軸</h3>
      <div className="views-range">
        <label className="views-field">
          <span>起</span>
          <input
            type="number"
            value={view.minYear}
            onChange={(e) => setView({ ...view, minYear: Number(e.target.value) })}
          />
        </label>
        <label className="views-field">
          <span>迄</span>
          <input
            type="number"
            value={view.maxYear}
            onChange={(e) => setView({ ...view, maxYear: Number(e.target.value) })}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            const u = union()
            if (u) setView({ ...view, ...u })
          }}
          disabled={cols.length === 0}
        >
          取所選主題的聯集
        </button>
        <label className="views-field">
          <span>開場縮放（px/年，留空自動）</span>
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={view.defaultPpy ?? ''}
            onChange={(e) =>
              setView({ ...view, defaultPpy: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          />
        </label>
      </div>
      <p className="views-hint">
        西元前用負數（前 500 = -500），沒有西元 0 年。範圍外的事件不會畫出來，欄位副標會註明有幾則。
      </p>

      <div className="views-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="views-primary" disabled={!valid}>
          儲存並開啟
        </button>
      </div>
    </form>
  )
}
