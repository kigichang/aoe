import { useCallback, useEffect, useRef, useState } from 'react'
import { CloseIcon } from '@web/components/icons'
import { fmtYear } from '@web/lib/scale'
import { api, gotoHit } from '../api'
import type { EventHit, Tag, TagGroup } from '../types'
import { tagTree } from './tagTree'

/**
 * 標題列的「標籤」：管理分組與 tag（新增／改名／換分組／換父層／刪除），
 * 以及依 tag 瀏覽事件（含子 tag）並跳過去。
 */
export function TagsOverlay({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selected, setSelected] = useState<Tag | null>(null)
  const [hits, setHits] = useState<EventHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 取名／改名用的輸入列。WebView 的 window.prompt 不可靠，自己畫一個。 */
  const [ask, setAsk] = useState<{ label: string; value: string; onOk: (v: string) => void } | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    const [g, t] = await Promise.all([api.listTagGroups(), api.listTags()])
    setGroups(g)
    setTags(t)
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

  useEffect(() => {
    if (!selected) {
      setHits(null)
      return
    }
    api.eventsWithTag(selected.id).then(setHits).catch((e) => setError(String(e)))
  }, [selected])

  const run = async (f: () => Promise<unknown>) => {
    setError(null)
    try {
      await f()
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  const addGroup = () =>
    setAsk({
      label: '新分組名稱',
      value: '',
      onOk: (name) => run(() => api.saveTagGroup({ id: `grp-${crypto.randomUUID().slice(0, 8)}`, name, order: groups.length })),
    })
  const renameGroup = (g: TagGroup) =>
    setAsk({ label: '分組名稱', value: g.name, onOk: (name) => run(() => api.saveTagGroup({ ...g, name })) })
  const removeGroup = (g: TagGroup) => {
    if (confirm(`刪除分組「${g.name}」？底下的 tag 會變成未分組。`)) run(() => api.deleteTagGroup(g.id))
  }
  const addTag = (groupId?: string, parentId?: string) =>
    setAsk({
      label: parentId ? '子 tag 名稱' : '新 tag 名稱',
      value: '',
      onOk: (name) =>
        run(() => api.saveTag({ id: `tag-${crypto.randomUUID().slice(0, 8)}`, name, groupId, parentId, order: 0, count: 0 })),
    })
  const renameTag = (t: Tag) =>
    setAsk({ label: 'Tag 名稱', value: t.name, onOk: (name) => run(() => api.saveTag({ ...t, name })) })
  const removeTag = (t: Tag) => {
    if (confirm(`刪除 tag「${t.name}」？${t.count} 則事件上的標記會一起移除，子 tag 會升一層。`)) {
      run(() => api.deleteTag(t.id))
      if (selected?.id === t.id) setSelected(null)
    }
  }
  const moveTag = (t: Tag, patch: Partial<Tag>) => run(() => api.saveTag({ ...t, ...patch }))

  const sections = tagTree(tags, groups)

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
              「分組」與「父層」是兩件事：分組是扁平的收納，只有根 tag 能選，子 tag 跟著父層走；父層是階層——用一個 tag 查事件時，會一併列出它的子 tag 打過的事件。
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
        <div className="tags-layout">
          <div className="tags-tree">
            {sections.map(({ group, nodes }) => (
              <div key={group?.id ?? '_'} className="tags-section">
                <h4>
                  {group?.name ?? '未分組'}
                  {group && (
                    <>
                      <button type="button" className="views-act" onClick={() => renameGroup(group)}>改名</button>
                      <button type="button" className="views-act" onClick={() => removeGroup(group)}>刪除</button>
                    </>
                  )}
                  <button type="button" className="views-act" onClick={() => addTag(group?.id)}>＋ tag</button>
                </h4>
                {nodes.map(({ tag, depth }) => (
                  <div
                    key={tag.id}
                    className={`tags-row${selected?.id === tag.id ? ' is-selected' : ''}`}
                    style={{ paddingLeft: depth * 16 }}
                  >
                    <button type="button" className="tags-name" onClick={() => setSelected(tag)}>
                      {tag.name} <span className="views-sub">{tag.count}</span>
                    </button>
                    <button type="button" className="views-act" onClick={() => addTag(tag.groupId, tag.id)} title="加子 tag">＋子</button>
                    <button type="button" className="views-act" onClick={() => renameTag(tag)}>改名</button>
                    <select
                      value={tag.groupId ?? ''}
                      onChange={(e) => moveTag(tag, { groupId: e.target.value || undefined })}
                      title="分組"
                      disabled={depth > 0}
                    >
                      <option value="">未分組</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
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
              </div>
            ))}
            <div className="views-actions">
              <button type="button" onClick={addGroup}>＋ 分組</button>
              <button type="button" onClick={() => addTag()}>＋ 未分組 tag</button>
            </div>
          </div>
          <div className="tags-hits">
            {!selected ? (
              <p className="views-sub">點左邊的 tag，列出打了它（含子 tag）的事件。</p>
            ) : (
              <>
                <h4>{selected.name}（{hits?.length ?? '…'}）</h4>
                <ul className="link-list">
                  {hits?.map((h) => (
                    <li key={h.ref}>
                      <button
                        type="button"
                        className={`link-target${h.orphan ? ' is-orphan' : ''}`}
                        disabled={h.orphan}
                        onClick={() => {
                          gotoHit(h)
                          onClose()
                        }}
                        title={h.orphan ? '這則事件已不存在' : `${h.topicName}／${h.regionName}`}
                      >
                        {!h.orphan && <span className="c-year">{fmtYear(h.year)}</span>}
                        <span className="c-title">{h.title}</span>
                        <span className="views-sub">{h.orphan ? '已不存在' : h.topicName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
