import type { Theme } from '../lib/theme'

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4l1.4-1.4M18 6l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5a8.6 8.6 0 1 0 11.3 11.3Z" />
    </svg>
  )
}

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
      <span>{label}</span>
    </button>
  )
}
