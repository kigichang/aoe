import type { ReactNode } from 'react'

/**
 * 全站共用的 inline SVG icon。
 *
 * 統一規格：24 viewBox、stroke: currentColor、round cap/join。
 * 之前的 ？/♥/✉/＋/−/×/✓ 是裸文字符號 —— ♥(U+2665) 與 ✉(U+2709) 在
 * iOS/Android 上會被 emoji 化（彩色、CSS color 失效），而窄螢幕下按鈕
 * 只剩 icon，這裡是唯一的識別通道，所以全部改成 SVG。
 *
 * 尺寸一律由使用處的 CSS 決定（如 `.theme-toggle svg { width: 15px }`），
 * icon 本身不帶 width/height。可及名稱由外層按鈕的 aria-label 承擔，
 * icon 一律 aria-hidden。
 */

interface IconProps {
  children: ReactNode
  strokeWidth?: number
  fill?: string
}

function Icon({ children, strokeWidth = 2, fill = 'none' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function SunIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4l1.4-1.4M18 6l1.4-1.4" />
    </Icon>
  )
}

export function MoonIcon() {
  return (
    <Icon>
      <path d="M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5a8.6 8.6 0 1 0 11.3 11.3Z" />
    </Icon>
  )
}

export function CaretDownIcon() {
  return (
    <Icon strokeWidth={2.4}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

export function QuestionIcon() {
  return (
    <Icon>
      <path d="M8.8 9.2a3.2 3.2 0 1 1 4.6 2.9c-.9.44-1.4 1-1.4 2v.4M12 18.3v.01" />
    </Icon>
  )
}

export function MailIcon() {
  return (
    <Icon>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m4.5 8 7.5 5.5L19.5 8" />
    </Icon>
  )
}

export function MinusIcon() {
  return (
    <Icon>
      <path d="M5.5 12h13" />
    </Icon>
  )
}

export function PlusIcon() {
  return (
    <Icon>
      <path d="M12 5.5v13M5.5 12h13" />
    </Icon>
  )
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Icon>
  )
}

/** 渲染尺寸只有 11px，stroke 2 會細到只剩不到 1px，所以加粗。 */
export function CheckIcon() {
  return (
    <Icon strokeWidth={3}>
      <path d="m5 12.5 5 4.5 9-10" />
    </Icon>
  )
}
