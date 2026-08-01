import { CATEGORIES, CATEGORY_IDS, type Category, type Region } from '../lib/schema'
import { minImportance } from '../lib/scale'

const JUMPS = [-2000, -1000, -500, 1, 500, 1000, 1500, 1800, 1950]

export interface RegionChip {
  region: Region
  /** 地區在 regions.yaml 裡的原始索引，決定配色 slot */
  slot: number
  visible: boolean
}

interface Props {
  ppy: number
  regions: RegionChip[]
  onToggleRegion: (id: string) => void
  categories: Set<Category>
  onToggleCategory: (c: Category) => void
  showLegendary: boolean
  onToggleLegendary: () => void
  onZoom: (factor: number) => void
  onJump: (year: number) => void
}

export function Toolbar({
  ppy,
  regions,
  onToggleRegion,
  categories,
  onToggleCategory,
  showLegendary,
  onToggleLegendary,
  onZoom,
  onJump,
}: Props) {
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
      {/* 這排同時是圖例：地區靠顏色識別，類別靠漢字識別 */}
      <div className="toolbar-row legend">
        <div className="chip-group" role="group" aria-label="顯示哪些地區">
          {regions.map(({ region, slot, visible }) => (
            <button
              type="button"
              key={region.id}
              className={`chip region-chip r${slot % 8}${visible ? ' is-on' : ''}`}
              aria-pressed={visible}
              onClick={() => onToggleRegion(region.id)}
            >
              <span className="swatch" aria-hidden="true" />
              {region.name}
            </button>
          ))}
        </div>

        <span className="group-sep" aria-hidden="true" />

        <div className="chip-group" role="group" aria-label="類別篩選">
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

        <span className="group-sep" aria-hidden="true" />

        {/*
          傳說是獨立的一軸，不是第七個類別 —— 伏羲仍然是「文化」、黃帝仍然是
          「戰爭」，這顆 chip 篩的是「年代確不確定」。
        */}
        <div className="chip-group" role="group" aria-label="傳說事件">
          <button
            type="button"
            className={`chip chip-legendary${showLegendary ? ' is-on' : ''}`}
            aria-pressed={showLegendary}
            onClick={onToggleLegendary}
            title="三皇五帝、神武天皇這類年代出自後世追記的事件"
          >
            <span className="glyph" aria-hidden="true">
              傳
            </span>
            傳說
          </button>
        </div>
      </div>
    </div>
  )
}
