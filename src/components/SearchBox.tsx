import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES } from '../lib/schema'
import { fmtYear } from '../lib/scale'
import { search, type Hit, type Indexed } from '../lib/search'

interface Props {
  all: Indexed[]
  onPick: (id: string) => void
}

export function SearchBox({ all, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const hits = useMemo(() => search(query, all), [query, all])

  // ⌘K／Ctrl+K 或 / 都能聚焦。/ 要避開正在打字的情況
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.isContentEditable)
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // 點到外面就收起結果，但不清掉輸入內容
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (hit: Hit) => {
    onPick(hit.event.id)
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!hits.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(hits[Math.min(active, hits.length - 1)])
    }
  }

  return (
    <div className="search" ref={boxRef}>
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        placeholder="搜尋事件…　⌘K"
        value={query}
        aria-label="搜尋事件"
        aria-expanded={open && hits.length > 0}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {open && query.trim() !== '' && (
        <div className="search-results" role="listbox">
          {hits.length === 0 ? (
            <p className="search-empty">找不到符合的事件</p>
          ) : (
            hits.map((hit, i) => (
              <button
                type="button"
                key={hit.event.id}
                role="option"
                aria-selected={i === active}
                className={`search-hit r${hit.slot % 8}${i === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(hit)}
              >
                <span className="glyph" aria-hidden="true">
                  {CATEGORIES[hit.event.category].glyph}
                </span>
                <span className="search-hit-year">{fmtYear(hit.event.year)}</span>
                <span className="search-hit-title">{hit.event.title}</span>
                <span className="search-hit-meta">
                  {hit.region.name}
                  {hit.why !== '標題' && ` ・${hit.why}`}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
