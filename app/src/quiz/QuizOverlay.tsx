import { useCallback, useEffect, useRef, useState } from 'react'
import { CloseIcon } from '@web/components/icons'
import { api } from '../api'
import { QUESTION_KINDS, type Question, type QuestionCard, type QuizStats } from '../types'
import { Practice } from './Practice'
import { QuestionEditor, emptyQuestion } from './QuestionEditor'

type Tab = 'practice' | 'list' | 'import'

/**
 * 標題列的「題庫」。三頁：練習（今日到期／錯題本／全部）、題目清單、匯入。
 * 也可以由外面帶一題進來直接編輯（詳情面板的「出題」）。
 */
export function QuizOverlay({ initialEdit, onClose }: { initialEdit?: Question; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(initialEdit ? 'list' : 'practice')
  const [stats, setStats] = useState<QuizStats | null>(null)
  const [list, setList] = useState<QuestionCard[]>([])
  const [editing, setEditing] = useState<Question | null>(initialEdit ?? null)
  const [queue, setQueue] = useState<QuestionCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const reload = useCallback(async () => {
    const [s, l] = await Promise.all([api.quizStats(), api.listQuestions()])
    setStats(s)
    setList(l)
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

  const start = async (mode: 'due' | 'wrong' | 'all') => {
    setError(null)
    try {
      const q = mode === 'all' ? await api.listQuestions() : await api.quizQueue(mode === 'wrong', 50)
      if (q.length === 0) {
        setError(mode === 'due' ? '今天沒有到期的題目。' : mode === 'wrong' ? '錯題本是空的。' : '還沒有題目。')
        return
      }
      setQueue(q)
    } catch (e) {
      setError(String(e))
    }
  }

  const doImport = async () => {
    setImportMsg(null)
    setError(null)
    try {
      const n = await api.importQuestions(importText, '貼上')
      setImportMsg(`匯入了 ${n} 題。`)
      setImportText('')
      await reload()
    } catch (e) {
      setError(String(e))
    }
  }

  const onFile = (f: File | undefined) => {
    if (!f) return
    f.text().then((t) => setImportText(t)).catch((e) => setError(String(e)))
  }

  const kindLabel = (k: string) => QUESTION_KINDS.find((x) => x.id === k)?.label ?? k

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help views-dialog quiz-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>題庫</h2>
          <button type="button" className="help-close" onClick={onClose} ref={closeRef} aria-label="關閉">
            <CloseIcon />
          </button>
        </div>

        {queue ? (
          <Practice
            queue={queue}
            onDone={() => {
              setQueue(null)
              reload()
            }}
            onExit={() => {
              setQueue(null)
              reload()
            }}
          />
        ) : editing ? (
          <QuestionEditor
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              setTab('list')
              reload()
            }}
          />
        ) : (
          <>
            <div className="quiz-tabs" role="tablist">
              {(
                [
                  ['practice', '練習'],
                  ['list', '題目'],
                  ['import', '匯入'],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            {error && <p className="views-error">{error}</p>}

            {tab === 'practice' && stats && (
              <div className="quiz-practice">
                <div className="quiz-stats">
                  <div>
                    <b>{stats.due}</b>
                    <span>今日到期</span>
                  </div>
                  <div>
                    <b>{stats.wrong}</b>
                    <span>錯題本</span>
                  </div>
                  <div>
                    <b>{stats.total}</b>
                    <span>全部</span>
                  </div>
                  <div>
                    <b>{stats.reviewedToday}</b>
                    <span>今天複習過</span>
                  </div>
                </div>
                <div className="views-actions quiz-start">
                  <button type="button" className="views-primary" onClick={() => start('due')} disabled={stats.due === 0}>
                    練今日到期
                  </button>
                  <button type="button" onClick={() => start('wrong')} disabled={stats.wrong === 0}>
                    練錯題本
                  </button>
                  <button type="button" onClick={() => start('all')} disabled={stats.total === 0}>
                    全部再練一遍
                  </button>
                </div>
                <p className="views-hint">
                  間隔重複（SM-2）：答對的題目下次出現得更晚，答錯的隔天再來，並進錯題本。
                </p>
              </div>
            )}

            {tab === 'list' && (
              <div>
                <div className="views-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
                  <button type="button" className="views-primary" onClick={() => setEditing(emptyQuestion())}>
                    ＋ 出題
                  </button>
                </div>
                <ul className="quiz-list">
                  {list.map((c) => (
                    <li key={c.id}>
                      <span className={`quiz-kind kind-${c.kind}`}>{kindLabel(c.kind)}</span>
                      <button type="button" className="quiz-prompt" onClick={() => setEditing(c)}>
                        {c.prompt}
                      </button>
                      <span className="views-sub">
                        {c.review.lapses > 0 ? `錯 ${c.review.lapses}` : ''}
                        {c.due ? ' 到期' : ''}
                      </span>
                      <button
                        type="button"
                        className="views-act"
                        onClick={async () => {
                          if (!confirm(`刪除「${c.prompt}」？`)) return
                          await api.deleteQuestion(c.id)
                          reload()
                        }}
                      >
                        刪除
                      </button>
                    </li>
                  ))}
                  {list.length === 0 && <li className="views-empty">還沒有題目。</li>}
                </ul>
              </div>
            )}

            {tab === 'import' && (
              <div className="quiz-import">
                <p className="help-lead">
                  貼上 <b>CSV</b>（表頭 <code>kind,prompt,options,answer,explanation,events</code>，options／events 用{' '}
                  <code>|</code> 分隔；answer：單選是索引、年份是 <code>1600</code> 或 <code>1600±5</code>
                  、排序留空、問答是文字）或 <b>Anki 純文字</b>（每行 <code>正面 Tab 背面</code>，匯成問答題）。
                  一筆有錯整批不匯入。
                </p>
                <input type="file" accept=".csv,.txt,.tsv" onChange={(e) => onFile(e.target.files?.[0])} />
                <textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="或直接貼在這裡…" />
                {importMsg && <p className="views-sub">{importMsg}</p>}
                <div className="views-actions">
                  <button type="button" className="views-primary" onClick={doImport} disabled={importText.trim() === ''}>
                    匯入
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
