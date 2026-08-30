import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@web/App'
import { TOPIC_ID } from '@web/lib/data'
import '@web/styles.css'
import './app.css'
import { ViewsOverlay } from './views/ViewsOverlay'

/**
 * 桌面版 = 網站的 <App> + 掛在擴充點上的桌面功能。
 * 這支檔案只負責組裝；各功能在 views/、editor/、quiz/ 自己的資料夾。
 */
function Desktop() {
  const [viewsOpen, setViewsOpen] = useState(false)
  return (
    <>
      {/* 跨主題 View 一次可能兩三千則，開視窗剔除；排版仍整欄算（見 RegionColumn.viewport） */}
      <App
        virtualize
        mastheadExtra={
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setViewsOpen(true)}
            title="跨主題組合視圖"
            aria-label="跨主題組合視圖"
          >
            <span className="btn-label">組合視圖</span>
          </button>
        }
      />
      {viewsOpen && <ViewsOverlay currentId={TOPIC_ID} onClose={() => setViewsOpen(false)} />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Desktop />
  </StrictMode>,
)
