import { useCallback, useEffect, useRef, useState } from 'react'
import { CloseIcon } from '@web/components/icons'
import { api } from '../api'
import type { BundleInfo, Orphan, SyncCheck } from '../types'

/**
 * 「資料」：目前載入的資料版本、檢查／套用線上更新、孤兒檢查、匯出自訂事件。
 *
 * 同步套用後整頁重載（上游表換了，View 是 per-document 常數）。
 * 孤兒（使用者資料指向已不存在的事件）**只列出、逐筆由使用者決定刪不刪**——
 * 上游改 id 或刪事件不該連使用者的筆記一起帶走。
 */
export function DataOverlay({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<BundleInfo | null>(null)
  const [check, setCheck] = useState<SyncCheck | null>(null)
  const [orphans, setOrphans] = useState<Orphan[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    const [i, o] = await Promise.all([api.bundleInfo(), api.listOrphans()])
    setInfo(i)
    setOrphans(o)
  }, [])
  useEffect(() => {
    load().catch((e) => setError(String(e)))
  }, [load])

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

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    setMsg(null)
    try {
      await f()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  const doCheck = () => run('check', async () => setCheck(await api.syncCheck()))
  const doApply = () =>
    run('apply', async () => {
      const [i, o] = await api.syncApply()
      setInfo(i)
      setOrphans(o)
      setCheck(null)
      setMsg(`已更新到 ${i.version}（${i.eventCount} 則）。${o.length ? `有 ${o.length} 筆孤兒，見下方。` : ''}重新載入畫面…`)
      setTimeout(() => location.reload(), o.length ? 2500 : 800)
    })
  const doExport = () =>
    run('export', async () => {
      const files = await api.exportUserEvents()
      setMsg(files.length ? `已匯出：\n${files.join('\n')}` : '沒有自訂事件可匯出。')
    })
  const removeOrphan = (o: Orphan) =>
    run('orphan', async () => {
      await api.deleteOrphan(o.kind, o.key)
      setOrphans(await api.listOrphans())
    })

  const kindLabel: Record<Orphan['kind'], string> = {
    event_tag: 'Tag',
    event_link: '關聯',
    question_event: '題目',
    placement: '自訂事件的欄位',
  }

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help views-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>資料</h2>
          <button type="button" className="help-close" onClick={onClose} ref={closeRef} aria-label="關閉">
            <CloseIcon />
          </button>
        </div>
        {error && <p className="views-error">{error}</p>}
        {msg && <p className="views-msg">{msg}</p>}

        <h3>歷史資料</h3>
        {info && (
          <p className="data-info">
            版本 <b>{info.version}</b>・{info.topicCount} 個主題・{info.eventCount} 則事件
            {info.importedAt && <span className="views-sub">載入於 {info.importedAt} UTC</span>}
            {info.fromRepo && <span className="views-sub">（開發模式：直接讀 repo 的 YAML，不做線上同步）</span>}
          </p>
        )}
        {!info?.fromRepo && (
          <div className="views-actions" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
            <button type="button" onClick={doCheck} disabled={busy !== null}>
              {busy === 'check' ? '檢查中…' : '檢查更新'}
            </button>
            {check && (
              <span className="views-sub">
                線上版本 {check.remote.version}・{check.remote.eventCount} 則・{(check.remote.size / 1024).toFixed(0)} KB
                {check.newer ? '' : '（已是最新）'}
              </span>
            )}
            {check?.newer && (
              <button type="button" className="views-primary" onClick={doApply} disabled={busy !== null}>
                {busy === 'apply' ? '下載中…' : '下載並套用'}
              </button>
            )}
          </div>
        )}
        <p className="views-hint">
          更新只換歷史資料；自訂事件、Tag、關聯、題目都會保留。下載後會驗 sha256、跑跟網站同一套資料檢查，
          任何一步失敗都保留現在的資料。
        </p>

        <h3>
          孤兒檢查
          <span className="views-sub">{orphans.length ? `${orphans.length} 筆` : '沒有問題'}</span>
        </h3>
        {orphans.length > 0 && (
          <>
            <p className="views-hint">
              這些筆記指向的事件已經不存在（上游改了 id、刪了事件，或欄位／類別表變了）。保留的是當時的標題快照；
              要留還是刪由你決定。
            </p>
            <ul className="link-list">
              {orphans.map((o) => (
                <li key={`${o.kind}:${o.key}`}>
                  <span className="quiz-kind">{kindLabel[o.kind]}</span>
                  <span className="c-title" style={{ flex: 1 }}>
                    {o.snapshot} <span className="views-sub">{o.detail}・{o.ref}</span>
                  </span>
                  <button type="button" className="views-act" onClick={() => removeOrphan(o)} disabled={busy !== null}>
                    刪除
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <h3>匯出</h3>
        <div className="views-actions" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
          <button type="button" onClick={doExport} disabled={busy !== null}>
            匯出自訂事件（YAML）
          </button>
        </div>
        <p className="views-hint">
          依主題／欄位各一個檔，格式跟 src/topics 一樣，想回貢獻到網站就直接複製進去。
        </p>
      </div>
    </div>
  )
}
