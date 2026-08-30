import { StrictMode, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@web/App'
import { REGIONS, TOPIC_ID } from '@web/lib/data'
import type { HistEvent } from '@web/lib/schema'
import '@web/styles.css'
import './app.css'
import { EventEditor } from './editor/EventEditor'
import { ViewsOverlay } from './views/ViewsOverlay'
import { EventExtras } from './tags/EventExtras'
import { TagsOverlay } from './tags/TagsOverlay'
import { QuizOverlay } from './quiz/QuizOverlay'
import { EventQuestions } from './quiz/EventQuestions'
import type { Question } from './types'
import { runPerf } from './perf'
import { USER_EVENT_PREFIX } from './types'

/**
 * 桌面版 = 網站的 <App> + 掛在擴充點上的桌面功能。
 * 這支檔案只負責組裝；各功能在 views/、editor/、quiz/ 自己的資料夾。
 */

/** 新增事件時預設放到目前 View 的第一欄。跨主題 View 的欄位 id 是 "topic:region" */
function defaultPlacement() {
  const first = REGIONS[0]
  if (!first) return undefined
  const [a, b] = first.id.split(':')
  return b ? { topic: a, region: b } : { topic: TOPIC_ID, region: a }
}

const PARAMS = new URLSearchParams(location.search)
/** `?virt=0` 關掉視窗剔除，給效能基準對照用 */
const VIRTUALIZE = PARAMS.get('virt') !== '0'
if (PARAMS.get('perf')) {
  setTimeout(() => runPerf(VIRTUALIZE ? 'virtualize=on' : 'virtualize=off'), 500)
}

function Desktop() {
  const [viewsOpen, setViewsOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const closeTags = useCallback(() => setTagsOpen(false), [])
  const [quiz, setQuiz] = useState<{ edit?: Question } | null>(null)
  const closeQuiz = useCallback(() => setQuiz(null), [])
  const [editor, setEditor] = useState<{ editRef?: string } | null>(null)
  const closeEditor = useCallback(() => setEditor(null), [])
  const closeViews = useCallback(() => setViewsOpen(false), [])
  // 每次 render 新物件會讓 EventEditor 的 effect 重跑，固定住
  const placement = useMemo(defaultPlacement, [])

  return (
    <>
      {/* 跨主題 View 一次可能兩三千則，開視窗剔除；排版仍整欄算（見 RegionColumn.viewport） */}
      <App
        virtualize={VIRTUALIZE}
        mastheadExtra={
          <>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setEditor({})}
              title="新增自訂事件"
              aria-label="新增自訂事件"
            >
              <span className="btn-label">＋ 事件</span>
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setQuiz({})}
              title="題庫與錯題本"
              aria-label="題庫與錯題本"
            >
              <span className="btn-label">題庫</span>
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTagsOpen(true)}
              title="標籤管理與瀏覽"
              aria-label="標籤管理與瀏覽"
            >
              <span className="btn-label">標籤</span>
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setViewsOpen(true)}
              title="跨主題組合視圖"
              aria-label="跨主題組合視圖"
            >
              <span className="btn-label">組合視圖</span>
            </button>
          </>
        }
        detailExtra={(e: HistEvent) => (
          <>
            {e.id.startsWith(USER_EVENT_PREFIX) && (
              <div className="detail-user">
                <span className="views-sub">自訂事件</span>
                <button type="button" className="views-act" onClick={() => setEditor({ editRef: e.id })}>
                  編輯
                </button>
              </div>
            )}
            {/* key 讓換一則事件時整個區塊重新載入，不沿用上一則的 tag／關聯 */}
            <EventExtras key={e.id} event={e} />
            <EventQuestions key={`q-${e.id}`} event={e} onEdit={(q) => setQuiz({ edit: q })} />
          </>
        )}
      />
      {viewsOpen && <ViewsOverlay currentId={TOPIC_ID} onClose={closeViews} />}
      {tagsOpen && <TagsOverlay onClose={closeTags} />}
      {quiz && <QuizOverlay initialEdit={quiz.edit} onClose={closeQuiz} />}
      {editor && (
        <EventEditor editRef={editor.editRef} initialPlacement={placement} onClose={closeEditor} />
      )}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Desktop />
  </StrictMode>,
)
