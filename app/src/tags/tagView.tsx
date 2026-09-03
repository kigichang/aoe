import { useCallback, useEffect, useRef, useState } from 'react'
import { CloseIcon } from '@web/components/icons'
import { api } from '../api'
import type { Tag } from '../types'

/**
 * 「顯示貼了某個 tag 的事件」。
 *
 * 做成**強調**而不是篩選：其餘事件照畫，橫向對照才不會斷 —— 同「搜尋是導覽，
 * 不是篩選」那條（CLAUDE.md）。強調的那組會被墊到最高重要度，所以不必放大
 * 就看得到；墊的是複本（見 `layout.ts` 的 `highlightImportance`），
 * 關掉就自動回到原本的重要度，沒有需要記帳的「還原」。
 *
 * 只認**目前這個 View 裡**的事件：`events_with_tag` 回的是全域 ref（含別的主題），
 * 一個都對不到就什麼事都不做、跳一個對話框說找不到 —— 換了強調狀態卻整片沒反應，
 * 比明講找不到更難懂。
 */
export interface TagView {
  /** 工具列那一格要印的字 */
  label: string
  /** 畫面上的事件 id（不是 ref） */
  ids: Set<string>
}

export function useTagView() {
  const [view, setView] = useState<TagView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const openTag = useCallback(async (tag: Tag) => {
    let hits
    try {
      hits = await api.eventsWithTag(tag.id)
    } catch (e) {
      setNotice(String(e))
      return
    }
    // ref → 畫面上的事件 id。refs 是 Rust 端給的對照表（見 api.ts 的 refOf），不要自己猜。
    const idByRef = new Map<string, string>()
    for (const [id, r] of Object.entries(window.__AOE_DATA__?.refs ?? {})) idByRef.set(r, id)

    const ids = new Set<string>()
    for (const h of hits) {
      const id = idByRef.get(h.ref)
      if (id) ids.add(id)
    }
    if (ids.size === 0) {
      setNotice(`這個主題裡找不到貼著「${tag.name}」的事件。`)
      return
    }
    setView({ label: `Tag：${tag.name}`, ids })
  }, [])

  const clear = useCallback(() => setView(null), [])
  const dismissNotice = useCallback(() => setNotice(null), [])

  return { view, openTag, clear, notice, dismissNotice }
}

/** 找不到事件（或查詢失敗）時的對話框。殼與 Esc 協定同 HelpOverlay。 */
export function TagNotice({ text, onClose }: { text: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help help-narrow"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <h2>找不到符合的事件</h2>
          <button type="button" className="help-close" onClick={onClose} aria-label="關閉">
            <CloseIcon />
          </button>
        </div>
        <p>{text}</p>
        <div className="views-actions">
          <button type="button" className="views-primary" onClick={onClose} ref={closeRef}>
            確定
          </button>
        </div>
      </div>
    </div>
  )
}
