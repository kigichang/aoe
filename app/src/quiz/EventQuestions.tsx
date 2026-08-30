import { useEffect, useState } from 'react'
import type { HistEvent } from '@web/lib/schema'
import { api, refOf } from '../api'
import type { Question, QuestionCard } from '../types'
import { questionFromEvent } from './QuestionEditor'

/** 詳情面板：這一則事件的相關題目 + 「出題」 */
export function EventQuestions({ event, onEdit }: { event: HistEvent; onEdit: (q: Question) => void }) {
  const ref = refOf(event.id)
  const [list, setList] = useState<QuestionCard[]>([])
  useEffect(() => {
    api.questionsForEvent(ref).then(setList).catch(() => setList([]))
  }, [ref])
  return (
    <section className="extras-block">
      <h3>
        題目
        <button type="button" className="views-act" onClick={() => onEdit(questionFromEvent({ ref, title: event.title, year: event.year }))}>
          出題
        </button>
      </h3>
      {list.length === 0 ? (
        <p className="views-sub">還沒有題目。</p>
      ) : (
        <ul className="quiz-list compact">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className="quiz-prompt" onClick={() => onEdit(c)}>
                {c.prompt}
              </button>
              <span className="views-sub">{c.review.lapses > 0 ? `錯 ${c.review.lapses}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
