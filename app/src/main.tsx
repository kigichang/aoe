import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@web/App'
import '@web/styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 跨主題 View 一次可能兩三千則，開視窗剔除；排版仍整欄算（見 RegionColumn.viewport） */}
    <App virtualize />
  </StrictMode>,
)
