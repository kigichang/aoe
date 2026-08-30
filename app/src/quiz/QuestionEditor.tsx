import { useEffect, useState } from 'react'
import { fmtYear } from '@web/lib/scale'
import { api } from '../api'
import { QUESTION_KINDS, type EventHit, type Question, type QuestionKind } from '../types'

const newId = () => `q-${crypto.randomUUID().slice(0, 8)}`

/** 從一則事件預填一題年份題 */
export function questionFromEvent(hit: { ref: string; title: string; year: number }): Question {
  return {
    id: newId(),
    kind: 'year',
    prompt: `「${hit.title}」發生在哪一年？`,
    options: [],
    answer: { year: hit.year, tolerance: 0 },
    events: [{ ref: hit.ref, title: hit.title }],
  }
}

export function emptyQuestion(): Question {
  return { id: newId(), kind: 'choice', prompt: '', options: ['', ''], answer: 0, events: [] }
}

interface Props {
  initial: Question
  onSaved: () => void
  onCancel: () => void
}

export function QuestionEditor({ initial, onSaved, onCancel }: Props) {
  const [q, setQ] = useState<Question>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setKind = (kind: QuestionKind) => {
    const base = { ...q, kind }
    if (kind === 'choice') setQ({ ...base, options: q.options.length >= 2 ? q.options : ['', ''], answer: 0 })
    else if (kind === 'year') setQ({ ...base, options: [], answer: { year: new Date().getFullYear(), tolerance: 0 } })
    else if (kind === 'order') setQ({ ...base, options: q.options.length >= 2 ? q.options : ['', ''], answer: null })
    else setQ({ ...base, options: [], answer: '' })
  }
  const setOpt = (i: number, v: string) => setQ({ ...q, options: q.options.map((o, k) => (k === i ? v : o)) })
  const yearAns = (q.answer ?? {}) as { year?: number; tolerance?: number }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.saveQuestion({ ...q, options: q.options.map((o) => o.trim()).filter((o) => o !== '') })
      onSaved()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <form
      className="views-form"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      {error && <p className="views-error">{error}</p>}
      <div className="views-range">
        <label className="views-field">
          <span>題型</span>
          <select value={q.kind} onChange={(e) => setKind(e.target.value as QuestionKind)}>
            {QUESTION_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="views-field views-field-wide">
        <span>題目</span>
        <textarea rows={2} value={q.prompt} onChange={(e) => setQ({ ...q, prompt: e.target.value })} autoFocus required />
      </label>

      {(q.kind === 'choice' || q.kind === 'order') && (
        <>
          <h3>{q.kind === 'choice' ? '選項（點左邊圓圈選正確答案）' : '項目（依正確順序）'}</h3>
          <ul className="views-cols">
            {q.options.map((o, i) => (
              <li key={i}>
                {q.kind === 'choice' && (
                  <input type="radio" name="answer" checked={q.answer === i} onChange={() => setQ({ ...q, answer: i })} />
                )}
                {q.kind === 'order' && <span className="views-sub">{i + 1}.</span>}
                <input type="text" value={o} onChange={(e) => setOpt(i, e.target.value)} />
                <button
                  type="button"
                  onClick={() =>
                    setQ({
                      ...q,
                      options: q.options.filter((_, k) => k !== i),
                      answer: q.kind === 'choice' ? Math.min(Number(q.answer), q.options.length - 2) : null,
                    })
                  }
                  disabled={q.options.length <= 2}
                  aria-label="移除"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="views-act"
            onClick={() => setQ({ ...q, options: [...q.options, ''] })}
            disabled={q.kind === 'choice' && q.options.length >= 6}
          >
            ＋ 選項
          </button>
        </>
      )}

      {q.kind === 'year' && (
        <div className="views-range">
          <label className="views-field">
            <span>正確年份（西元前用負數）</span>
            <input
              type="number"
              value={yearAns.year ?? ''}
              onChange={(e) => setQ({ ...q, answer: { ...yearAns, year: Number(e.target.value) } })}
              required
            />
          </label>
          <label className="views-field">
            <span>容錯 ± 年</span>
            <input
              type="number"
              min={0}
              value={yearAns.tolerance ?? 0}
              onChange={(e) => setQ({ ...q, answer: { ...yearAns, tolerance: Number(e.target.value) } })}
            />
          </label>
        </div>
      )}

      {q.kind === 'flash' && (
        <label className="views-field views-field-wide">
          <span>答案（作答後自己評分）</span>
          <textarea rows={3} value={String(q.answer ?? '')} onChange={(e) => setQ({ ...q, answer: e.target.value })} />
        </label>
      )}

      <label className="views-field views-field-wide">
        <span>解析（選填）</span>
        <textarea rows={2} value={q.explanation ?? ''} onChange={(e) => setQ({ ...q, explanation: e.target.value })} />
      </label>

      <h3>相關事件</h3>
      <EventPicker value={q.events} onChange={(events) => setQ({ ...q, events })} />

      <div className="views-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="views-primary" disabled={busy || q.prompt.trim() === ''}>
          儲存
        </button>
      </div>
    </form>
  )
}

function EventPicker({
  value,
  onChange,
}: {
  value: { ref: string; title: string }[]
  onChange: (v: { ref: string; title: string }[]) => void
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<EventHit[]>([])
  useEffect(() => {
    if (!q.trim()) {
      setHits([])
      return
    }
    const t = setTimeout(() => api.searchEvents(q, 15).then(setHits).catch(() => {}), 150)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="link-form">
      <div className="tag-chips">
        {value.map((e) => (
          <span key={e.ref} className="tag-chip">
            {e.title || e.ref}
            <button type="button" className="chip-x" onClick={() => onChange(value.filter((x) => x.ref !== e.ref))} aria-label="移除">
              ✕
            </button>
          </span>
        ))}
      </div>
      <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋事件標題加進來…" />
      {hits.length > 0 && (
        <ul className="link-hits">
          {hits
            .filter((h) => !value.some((v) => v.ref === h.ref))
            .map((h) => (
              <li key={h.ref}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...value, { ref: h.ref, title: h.title }])
                    setQ('')
                  }}
                >
                  <span className="c-year">{fmtYear(h.year)}</span>
                  <span className="c-title">{h.title}</span>
                  <span className="views-sub">{h.topicName}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
