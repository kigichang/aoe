import { CATEGORIES, CATEGORY_IDS, type Category } from '../lib/schema'
import { minImportance } from '../lib/scale'

const JUMPS = [-2000, -1000, -500, 1, 500, 1000, 1500, 1800, 1950]

interface Props {
  ppy: number
  categories: Set<Category>
  onToggleCategory: (c: Category) => void
  onZoom: (factor: number) => void
  onJump: (year: number) => void
}

export function Toolbar({ ppy, categories, onToggleCategory, onZoom, onJump }: Props) {
  const floor = minImportance(ppy)
  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <div className="zoom">
          <button type="button" onClick={() => onZoom(1 / 1.6)} aria-label="縮小">
            −
          </button>
          <button type="button" onClick={() => onZoom(1.6)} aria-label="放大">
            ＋
          </button>
          <span className="hint">
            重要度 {floor}+ ・ ⌘/Ctrl + 滾輪縮放
          </span>
        </div>
        <nav className="jumps" aria-label="跳到年代">
          {JUMPS.map((y) => (
            <button type="button" key={y} onClick={() => onJump(y)}>
              {y < 0 ? `前${-y}` : y}
            </button>
          ))}
        </nav>
      </div>
      {/* 這排同時是圖例：類別靠漢字識別，不靠顏色 */}
      <div className="toolbar-row legend" role="group" aria-label="類別篩選">
        {CATEGORY_IDS.map((id) => {
          const on = categories.has(id)
          return (
            <button
              type="button"
              key={id}
              className={`chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onToggleCategory(id)}
            >
              <span className="glyph" aria-hidden="true">
                {CATEGORIES[id].glyph}
              </span>
              {CATEGORIES[id].label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
