import { useCallback, useEffect, useRef, useState } from 'react'
import { CloseIcon } from '@web/components/icons'
import { api } from '../api'
import type { Tag } from '../types'
import { tagTree } from './tagTree'

/**
 * 標題列的「標籤」：管理 tag（新增／改名／換父層／刪除）。貼 tag 在詳情面板做。
 *
 * 點 tag 的名字＝在時間軸上標出貼著它的事件（`onPick`，見 tagView.tsx），
 * 由呼叫端決定要不要關掉這個視窗 —— 這裡只負責回報「使用者點了誰」。
 */
export function TagsOverlay({ onClose, onPick }: { onClose: () => void; onPick: (t: Tag) => void }) {
  const [tags, setTags] = useState<Tag[]>([])
  const [error, setError] = useState<string | null>(null)
  /** 取名／改名用的輸入列。WebView 的 window.prompt 不可靠，自己畫一個。 */
  const [ask, setAsk] = useState<{ label: string; value: string; onOk: (v: string) => void } | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    setTags(await api.listTags())
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

  const run = async (f: () => Promise<unknown>) => {
    setError(null)
    try {
      await f()
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  const addTag = (parentId?: string) =>
    setAsk({
      label: parentId ? '子 tag 名稱' : '新 tag 名稱',
      value: '',
      onOk: (name) =>
        run(() => api.saveTag({ id: `tag-${crypto.randomUUID().slice(0, 8)}`, name, parentId, order: 0, count: 0 })),
    })
  const renameTag = (t: Tag) =>
    setAsk({ label: 'Tag 名稱', value: t.name, onOk: (name) => run(() => api.saveTag({ ...t, name })) })
  const removeTag = (t: Tag) => {
    if (confirm(`刪除 tag「${t.name}」？${t.count} 則事件上的標記會一起移除，子 tag 會升一層。`)) {
      run(() => api.deleteTag(t.id))
    }
  }
  const moveTag = (t: Tag, patch: Partial<Tag>) => run(() => api.saveTag({ ...t, ...patch }))

  const nodes = tagTree(tags)

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help views-dialog tags-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>
            標籤
            <span className="views-tip views-tip-below">
            <button type="button" className="views-tip-btn" aria-label="標籤說明" aria-describedby="tags-tip">
              ?
            </button>
            <span className="views-tip-body" id="tags-tip" role="tooltip">
              {/* 一行寫完：JSX 跨行的文字會被接成一個半形空白，中文句號後面會多出一格 */}
              「父層」是階層：子 tag 縮排在父層底下，刪掉父層時子 tag 會升一層。貼 tag 在事件的詳情面板做。
            </span>
          </span>
          </h2>
          <button type="button" className="help-close" onClick={onClose} ref={closeRef} aria-label="關閉">
            <CloseIcon />
          </button>
        </div>
        {error && <p className="views-error">{error}</p>}
        {ask && (
          <form
            className="tag-quick"
            onSubmit={(e) => {
              e.preventDefault()
              const v = ask.value.trim()
              setAsk(null)
              if (v) ask.onOk(v)
            }}
          >
            <span className="views-sub">{ask.label}</span>
            <input type="text" value={ask.value} onChange={(e) => setAsk({ ...ask, value: e.target.value })} autoFocus />
            <button type="submit" className="views-primary">確定</button>
            <button type="button" className="views-act" onClick={() => setAsk(null)}>取消</button>
          </form>
        )}
        <div className="tags-tree">
          {nodes.length === 0 && <p className="views-sub">還沒有 tag。</p>}
          {nodes.map(({ tag, depth }) => (
            <div key={tag.id} className="tags-row" style={{ paddingLeft: depth * 16 }}>
              <button
                type="button"
                className="tags-name"
                onClick={() => onPick(tag)}
                title={`在時間軸上標出貼著「${tag.name}」的事件`}
              >
                {tag.name} <span className="views-sub">{tag.count}</span>
              </button>
              <button type="button" className="views-act" onClick={() => addTag(tag.id)} title="加子 tag">＋子</button>
              <button type="button" className="views-act" onClick={() => renameTag(tag)}>改名</button>
              <select
                value={tag.parentId ?? ''}
                onChange={(e) => moveTag(tag, { parentId: e.target.value || undefined })}
                title="父層"
              >
                <option value="">（根）</option>
                {tags.filter((x) => x.id !== tag.id).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
              <button type="button" className="views-act" onClick={() => removeTag(tag)}>刪除</button>
            </div>
          ))}
          <div className="views-actions">
            <button type="button" onClick={() => addTag()}>＋ tag</button>
          </div>
        </div>
      </div>
    </div>
  )
}
