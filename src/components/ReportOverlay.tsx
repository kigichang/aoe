import { useEffect, useRef } from 'react'

const ISSUES = 'https://github.com/kigichang/aoe'
const EMAIL = 'me@kigi.tw'
/** 預設信件標題。encodeURIComponent 是必要的：中括號與中文都得轉義 */
const SUBJECT = '[AOE] 問題或建議標題'
const MAILTO = `mailto:${EMAIL}?subject=${encodeURIComponent(SUBJECT)}`
const DONATE = 'https://official.junyiacademy.org/donate/'

interface Props {
  onClose: () => void
}

/**
 * 問題回報的小視窗。版面直接沿用說明覆蓋層的 `.help-backdrop` / `.help`，
 * 只多一個 `.help-narrow` 收窄寬度 —— 同一種「浮在上面的對話框」不該有兩套樣式。
 */
export function ReportOverlay({ onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  // 開啟前的焦點，關閉時要還回去，鍵盤使用者才不會被丟回頁首
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 標記這次 Esc 已被吃掉，否則詳情面板（掛在 window，比這裡晚跑）
      // 會跟著一起關掉 —— 一次 Esc 只該關最上面那一層。見 CLAUDE.md「Esc 的分層規則」
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      restoreTo.current?.focus?.()
    }
  }, [onClose])

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help help-narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        // 點內容不該關掉
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <h2 id="report-title">問題回報</h2>
          <button
            type="button"
            className="help-close"
            onClick={onClose}
            ref={closeRef}
            aria-label="關閉問題回報"
          >
            ✕
          </button>
        </div>

        <p className="help-lead">
          如果有任何問題與建議，歡迎到{' '}
          <a className="help-link" href={ISSUES} target="_blank" rel="noreferrer">
            github.com/kigichang/aoe
          </a>{' '}
          發 Issue，或 Email 給{' '}
          <a className="help-link" href={MAILTO}>
            {EMAIL}
          </a>
          。
        </p>

        <p>
          如果你喜歡我的創作或者有幫助到你的學習，請贊助支持均一：
        </p>
        <p>
          <a className="help-link" href={DONATE} target="_blank" rel="noreferrer">
            official.junyiacademy.org/donate →
          </a>
        </p>
      </div>
    </div>
  )
}
