import { api } from './api'

/**
 * 網站把主題當 per-document 常數（`MIN_YEAR`、`REGIONS` 都是模組層常數，
 * 見 ../src/lib/topic.ts 開頭）。桌面版順著這個設計：**一個 View = 一次載入**。
 *
 * 所以 React 與網站程式碼要等資料到手才能 import —— shim 的 `data.ts`
 * 在模組層讀 `window.__AOE_DATA__`，那時候資料必須已經在了。
 * 切換 View 就 `location.href = '?view=…'` 整頁重載。
 */
const view = new URLSearchParams(location.search).get('view')

try {
  window.__AOE_DATA__ = await api.getViewPayload(view)
  await import('./main')
} catch (err) {
  // 跟網站「寧可整片白配一則明確訊息」同一個精神
  const pre = document.createElement('pre')
  pre.style.cssText = 'padding:24px;white-space:pre-wrap;font:14px/1.6 system-ui'
  pre.textContent = `資料載入失敗：\n${err instanceof Error ? err.message : String(err)}`
  document.body.replaceChildren(pre)
}
