import type { Theme } from '../lib/theme'
import { MoonIcon, SunIcon } from './icons'

interface Props {
  theme: Theme
  onToggle: () => void
}

/** 顯示的是「按下去會變成什麼」，配上文字才不會有「這是現況還是目標」的歧義。 */
export function ThemeToggle({ theme, onToggle }: Props) {
  const next = theme === 'dark' ? 'light' : 'dark'
  const label = next === 'dark' ? '暗色' : '亮色'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      title={`切換為${label}系主題`}
      aria-label={`切換為${label}系主題`}
    >
      {next === 'dark' ? <MoonIcon /> : <SunIcon />}
      <span className="btn-label">{label}</span>
    </button>
  )
}
