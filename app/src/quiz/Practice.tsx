import { useEffect, useMemo, useState } from 'react'
import { fmtYear } from '@web/lib/scale'
import { api, gotoHit } from '../api'
import type { QuestionCard } from '../types'

/**
 * 練習流程：一題一題出，作答 → 對答案 → 看解析與相關事件 → 下一題。
 * 單選／年份／排序自動評分（對 = 4，錯 = 1），問答自評 1／3／5。
 */
export function Practice({ queue, onDone, onExit }: { queue: QuestionCard[]; onDone: () => void; onExit: () => void }) {
  const [i, setI] = useState(0)
  const [result, setResult] = useState<{ correct: boolean | null; grade?: number } | null>(null)
  const [startedAt, setStartedAt] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)
  const card = queue[i]

  useEffect(() => {
    setResult(null)
    setStartedAt(Date.now())
  }, [i])

  if (!card) {
    return (
      <div className="practice-done">
        <p>這一輪結束了。</p>
        <button type="button" className="views-primary" onClick={onDone}>
          回錯題本
        </button>
      </div>
    )
  }

  const grade = async (g: number, correct: boolean | null) => {
    try {
      await api.gradeQuestion(card.id, g, Date.now() - startedAt)
      setResult({ correct, grade: g })
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="practice">
      <div className="practice-head">
        <span className="views-sub">
          {i + 1} / {queue.length}・{card.review.lapses > 0 ? `錯過 ${card.review.lapses} 次` : '尚未答錯'}
        </span>
        <button type="button" className="views-act" onClick={onExit}>
          結束
        </button>
      </div>
      {error && <p className="views-error">{error}</p>}
      <p className="practice-prompt">{card.prompt}</p>

      {!result ? (
        <Answerer key={card.id} card={card} onGrade={grade} />
      ) : (
        <div className="practice-result">
          {result.correct !== null && (
            <p className={result.correct ? 'is-correct' : 'is-wrong'}>{result.correct ? '答對了' : '答錯了'}</p>
          )}
          <CorrectAnswer card={card} />
          {card.explanation && <p className="practice-explain">{card.explanation}</p>}
          {card.hits.length > 0 && (
            <ul className="link-list">
              {card.hits.map((h) => (
                <li key={h.ref}>
                  <button type="button" className="link-target" disabled={h.orphan} onClick={() => gotoHit(h)}>
                    {!h.orphan && <span className="c-year">{fmtYear(h.year)}</span>}
                    <span className="c-title">{h.title}</span>
                    <span className="views-sub">{h.topicName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="views-actions">
            <button type="button" className="views-primary" onClick={() => setI(i + 1)} autoFocus>
              下一題
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CorrectAnswer({ card }: { card: QuestionCard }) {
  if (card.kind === 'choice') return <p>正確答案：{card.options[Number(card.answer)]}</p>
  if (card.kind === 'year') {
    const a = card.answer as { year: number; tolerance: number }
    return (
      <p>
        正確答案：{fmtYear(a.year)}
        {a.tolerance > 0 ? `（±${a.tolerance} 年）` : ''}
      </p>
    )
  }
  if (card.kind === 'order') return <p>正確順序：{card.options.join(' → ')}</p>
  return <p className="practice-flash-answer">{String(card.answer)}</p>
}

function Answerer({ card, onGrade }: { card: QuestionCard; onGrade: (g: number, correct: boolean | null) => void }) {
  const [year, setYear] = useState('')
  const [shown, setShown] = useState(false)
  // 排序題：打亂後讓使用者用上下鍵排；同一題只打亂一次
  const shuffled = useMemo(() => {
    const arr = card.options.map((o, i) => ({ o, i }))
    for (let k = arr.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1))
      ;[arr[k], arr[j]] = [arr[j], arr[k]]
    }
    // 打亂後剛好等於正確順序就再轉一下
    if (arr.every((x, k) => x.i === k) && arr.length > 1) arr.push(arr.shift()!)
    return arr
  }, [card.options])
  const [order, setOrder] = useState(shuffled)

  if (card.kind === 'choice') {
    return (
      <div className="practice-choices">
        {card.options.map((o, i) => (
          <button key={i} type="button" onClick={() => onGrade(i === Number(card.answer) ? 4 : 1, i === Number(card.answer))}>
            {o}
          </button>
        ))}
      </div>
    )
  }
  if (card.kind === 'year') {
    const a = card.answer as { year: number; tolerance: number }
    const submit = () => {
      const y = Number(year)
      if (!Number.isFinite(y) || year.trim() === '') return
      const ok = Math.abs(y - a.year) <= (a.tolerance ?? 0)
      onGrade(ok ? 4 : 1, ok)
    }
    return (
      <form
        className="practice-year"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="西元年，前用負數" autoFocus />
        <button type="submit" className="views-primary">
          作答
        </button>
      </form>
    )
  }
  if (card.kind === 'order') {
    const move = (k: number, d: -1 | 1) => {
      const j = k + d
      if (j < 0 || j >= order.length) return
      const next = [...order]
      ;[next[k], next[j]] = [next[j], next[k]]
      setOrder(next)
    }
    return (
      <div>
        <ol className="practice-order">
          {order.map((x, k) => (
            <li key={x.i}>
              <span>{x.o}</span>
              <button type="button" onClick={() => move(k, -1)} disabled={k === 0} aria-label="上移">
                ↑
              </button>
              <button type="button" onClick={() => move(k, 1)} disabled={k === order.length - 1} aria-label="下移">
                ↓
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="views-primary"
          onClick={() => {
            const ok = order.every((x, k) => x.i === k)
            onGrade(ok ? 4 : 1, ok)
          }}
        >
          作答
        </button>
      </div>
    )
  }
  // flash
  return !shown ? (
    <button type="button" className="views-primary" onClick={() => setShown(true)} autoFocus>
      看答案
    </button>
  ) : (
    <div>
      <p className="practice-flash-answer">{String(card.answer)}</p>
      <div className="practice-self">
        <span className="views-sub">你答得如何？</span>
        <button type="button" onClick={() => onGrade(1, null)}>
          不會
        </button>
        <button type="button" onClick={() => onGrade(3, null)}>
          勉強
        </button>
        <button type="button" className="views-primary" onClick={() => onGrade(5, null)}>
          會
        </button>
      </div>
    </div>
  )
}
