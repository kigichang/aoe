import { useEffect, useRef, useState } from 'react'
import { TOPIC, TOPICS } from '../lib/data'
import { fmtYear } from '../lib/scale'
import { CaretDownIcon, CheckIcon } from './icons'

/**
 * 主題切換器。
 *
 * **每一列是真的 `<a href>`，走整頁導覽，不是 `setState`。** 主題是 per-document
 * 的常數（見 `topic.ts` 開頭那段），`MIN_YEAR`／`REGIONS`／`CATEGORIES` 之所以
 * 能維持模組層常數就是靠這件事。改成前端切換會讓 `scale.ts` 的
 * `MIN_YEAR / MAX_YEAR / SPAN_YEARS` 變成函式參數，一路擴散到每一支檔案。
 *
 * 用 `<a>` 還順便換到中鍵開新分頁、複製連結網址、右鍵選單，都不必自己實作。
 *
 * **連結不帶 hash。** 網址上的 `#y/#z/#e` 是主題內的東西：年份範圍不同
 * （前3000–2026 vs 1885–2026），事件 id 也不通用。帶過去只會被夾到邊界，
 * 或指向一則不存在的事件 —— 看起來像跳錯地方，比乾脆從新主題的開場位置
 * 重新開始更難理解。
 */

export function TopicSwitcher() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // 開啟時才掛監聽：Esc 與點外面都關掉，Esc 還要把焦點還給觸發鈕，
  // 鍵盤使用者才不會被丟回頁首（同 HelpOverlay 的作法）。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 標記已處理，詳情面板才不會跟著一起關掉。見 DetailPanel 的 Esc 那段。
      e.preventDefault()
      setOpen(false)
      btnRef.current?.focus()
    }
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  // 只有一個主題時整個不畫。專案既有規則：沒有資料的 UI 就不顯示，
  // 不要留一顆按了只會列出自己的開關（同鐵道史沒有傳說事件就不畫那顆 chip）。
  if (TOPICS.length < 2) return null

  return (
    <div className="topic-switcher" ref={wrapRef}>
      <button
        type="button"
        className="theme-toggle topic-trigger"
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title="切換主題"
      >
        <span>{TOPIC.name}</span>
        <CaretDownIcon />
      </button>

      {open && (
        <nav className="topic-menu" aria-label="切換主題">
          {TOPICS.map((t) => (
            <a
              key={t.slug}
              className={`topic-item${t.isCurrent ? ' is-current' : ''}`}
              href={t.href}
              aria-current={t.isCurrent ? 'page' : undefined}
            >
              <span className="topic-item-name">
                {/* 固定寬度的勾記欄位，主題名才會對齊 */}
                <span className="topic-check" aria-hidden="true">
                  {t.isCurrent ? <CheckIcon /> : null}
                </span>
                {t.meta.name}
              </span>
              {t.timeline && (
                <span className="topic-item-range">
                  {fmtYear(t.timeline.minYear)}–{fmtYear(t.timeline.maxYear)}
                </span>
              )}
            </a>
          ))}
        </nav>
      )}
    </div>
  )
}
