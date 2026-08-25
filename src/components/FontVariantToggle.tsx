import { useState } from 'react'

/**
 * ⚠ 暫時：字型 A/B 測試開關，定案後整檔刪除。
 *
 * A = 全站 Noto Sans TC（預設）。
 * B = 同 A，但站名標題與朝代直排名稱改用 LXGW 文楷（見 styles.css 檔尾的
 *     ⚠ 暫時區塊與 index.html 的 LXGW link + data-font script）。
 *
 * 狀態記在 localStorage（本專案規定：偏好狀態不進網址）。key 必須跟
 * index.html 防閃爍 script 讀的一致。
 */
const FONT_KEY = 'aoe:font'

function readVariant(): 'a' | 'b' {
  try {
    return localStorage.getItem(FONT_KEY) === 'b' ? 'b' : 'a'
  } catch {
    return 'a'
  }
}

/** 顯示的是「按下去會變成什麼」，同 ThemeToggle 的語意慣例。 */
export function FontVariantToggle() {
  const [variant, setVariant] = useState<'a' | 'b'>(readVariant)
  const next = variant === 'b' ? 'a' : 'b'
  const label = next === 'b' ? '字型B' : '字型A'

  const toggle = () => {
    if (next === 'b') {
      document.documentElement.dataset.font = 'b'
    } else {
      delete document.documentElement.dataset.font
    }
    try {
      if (next === 'b') localStorage.setItem(FONT_KEY, 'b')
      else localStorage.removeItem(FONT_KEY)
    } catch {
      // 隱私模式：切換仍生效，只是不記憶
    }
    setVariant(next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={`切換為${label}（Noto Sans TC${next === 'b' ? ' + 文楷標題' : ''}）`}
      aria-label={`切換為${label}`}
    >
      {/* 刻意不用 .btn-label：窄螢幕會把 .btn-label 藏起來只留 icon，
          這顆沒有 icon，藏了就變成一顆空按鈕。 */}
      <span>{label}</span>
    </button>
  )
}
