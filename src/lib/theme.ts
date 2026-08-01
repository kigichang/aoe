import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'aoe:theme'

const readStored = (): Theme | null => {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' ? saved : null
  } catch {
    // 隱私模式下 localStorage 可能整個不能用，不該讓網站掛掉
    return null
  }
}

const systemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

/**
 * 主題有三種狀態，但介面上只露出兩種：
 * 沒有手動指定過（override = null）時跟著系統走，按下切換鈕才寫死。
 * CSS 那邊靠 :root[data-theme] 覆蓋，兩個方向都要贏過 prefers-color-scheme。
 */
export function useTheme() {
  const [override, setOverride] = useState<Theme | null>(readStored)
  const [system, setSystem] = useState<Theme>(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = override ?? system

  useEffect(() => {
    try {
      if (override) {
        document.documentElement.dataset.theme = override
        localStorage.setItem(THEME_KEY, override)
      } else {
        delete document.documentElement.dataset.theme
        localStorage.removeItem(THEME_KEY)
      }
    } catch {
      // 同上，存不進去就算了，當下這次切換還是有效
    }
  }, [override])

  const toggle = useCallback(() => {
    setOverride(theme === 'dark' ? 'light' : 'dark')
  }, [theme])

  return { theme, toggle }
}
