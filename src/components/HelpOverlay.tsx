import { useEffect, useRef } from 'react'
import { CATEGORIES, CATEGORY_IDS } from '../lib/schema'

const REPO = 'https://github.com/kigichang/aoe'

/**
 * 圖例裡的範例**用真正的 class 畫**（`.mark`、`.leader`、`.mark-dot-only`…），
 * 不是另外畫一套示意圖。這樣改了 styles.css，說明會跟著變，不會像用圖片或
 * 手繪 SVG 那樣悄悄與實際畫面脫節。
 *
 * `.r0` 是為了給 `--region`：欄位靠那個變數上色，範例也要有才顯示得出來。
 */
function Sample({ children, height = 30 }: { children: React.ReactNode; height?: number }) {
  return (
    <div className="help-sample r0" style={{ height }}>
      {children}
    </div>
  )
}

function Mark({
  glyph,
  year,
  title,
  legendary,
  imp = 4,
  top = 2,
}: {
  glyph: string
  year: string
  title: string
  legendary?: boolean
  imp?: number
  /** 樣本框內的位置。引線那一條要靠它示範「標籤被推開」 */
  top?: number
}) {
  return (
    <button
      type="button"
      className={`mark imp-${imp}${legendary ? ' is-legendary' : ''}`}
      style={{ top }}
      tabIndex={-1}
    >
      <span className="glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="mark-year">{year}</span>
      <span className="mark-title">{title}</span>
    </button>
  )
}

interface Props {
  onClose: () => void
}

export function HelpOverlay({ onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  // 開啟前的焦點，關閉時要還回去，鍵盤使用者才不會被丟回頁首
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      restoreTo.current?.focus?.()
    }
  }, [onClose])

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        // 點內容不該關掉
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <h2 id="help-title">怎麼讀這張圖</h2>
          <button type="button" className="help-close" onClick={onClose} ref={closeRef} aria-label="關閉說明">
            ✕
          </button>
        </div>

        <p className="help-lead">
          每一欄是一個地區，縱軸是年份。<strong>同一個高度就是同一年</strong>，跨欄也成立 ——
          這是整個網站唯一的承諾，所以刻度是線性的，位置也不會為了排版好看而挪動。
        </p>

        <h3>操作</h3>
        <ul className="help-list">
          <li>
            <kbd>⌘</kbd>／<kbd>Ctrl</kbd> + 滾輪，或左上角 <kbd>＋</kbd> <kbd>−</kbd> 縮放。
          </li>
          <li>右上角的年代按鈕會跳到那一年。</li>
          <li>
            上排的圓角標籤是<strong>開關</strong>：地區、類別、傳說都可以個別關掉。
          </li>
          <li>點任何一則事件，右下角會顯示詳情、出處，以及其他地區的同時期事件。</li>
          <li>
            <strong>網址會跟著你走</strong> —— 捲到哪、縮放多少、選了哪則事件都記在網址列，
            直接複製就能把「這個年代」分享給別人。
          </li>
          <li>
            <strong>縮得越遠，顯示的事件越少</strong> —— 只留下最重要的，否則五千年擠成一團誰也讀不到。
            覺得某段太空，放大就會逐層出現。
          </li>
        </ul>

        <h3>圖釘怎麼讀</h3>

        <div className="help-rows">
          <div>
            <Sample>
              <Mark glyph="政" year="前221" title="秦滅六國，統一中國" imp={5} />
            </Sample>
            <p>
              圓圈裡的<strong>漢字是類別</strong>，圓圈的<strong>顏色是地區</strong>（與欄位標題同色）。
              類別不用顏色區分 —— 六個類別沒有任何一組配色能同時通過色盲安全距離，漢字是更可靠的識別方式。
            </p>
            <p className="help-cats">
              {CATEGORY_IDS.map((id) => (
                <span key={id}>
                  <span className="glyph r0" aria-hidden="true">
                    {CATEGORIES[id].glyph}
                  </span>
                  {CATEGORIES[id].label}
                </span>
              ))}
            </p>
          </div>

          <div>
            <Sample height={56}>
              <Mark glyph="戰" year="前1200" title="青銅時代崩潰" />
              <Mark glyph="戰" year="前1184" title="特洛伊戰爭傳說" legendary top={30} />
            </Sample>
            <p>
              <strong>實線圈</strong>是有考古或文獻佐證的年代；
              <strong>虛線圈加斜體年份</strong>表示這是<strong>傳說</strong> ——
              年代出自後世追記，不是定年（黃帝、神武天皇、羅馬建城都屬於這類）。
              它們仍然畫在傳世年代的位置上，但視覺上明確標示為不確定。上排的「傳說」可以整組關掉。
            </p>
          </div>

          <div>
            <Sample height={62}>
              {/* 引線從真實年份（top: 8）拉到被推開的標籤（中心 34） */}
              <div className="leader" style={{ top: 8, height: 26, left: 11 }} />
              <Mark glyph="文" year="前213" title="焚書坑儒" imp={3} top={23} />
            </Sample>
            <p>
              事件太密時，標籤會被往下推開，並留下一條<strong>引線</strong>。
              <strong>引線頂端那一小橫才是真實年份</strong>，標籤本身的位置是挪過的。
              位移有嚴格上限，絕不會讓兩則事件的先後順序顛倒。
            </p>
          </div>

          <div>
            <Sample height={34}>
              <span className="mark mark-dot-only" style={{ top: 12 }} />
            </Sample>
            <p>
              擠不下標籤時會退化成<strong>一個小圓點</strong>，只標出年份位置。
              點它一樣看得到內容，放大之後標籤就會出現。
            </p>
          </div>

          <div>
            <Sample height={58}>
              <div className="span" style={{ top: 13, height: 34, left: 11 }} />
              <Mark glyph="戰" year="1592" title="萬曆朝鮮之役" top={2} />
            </Sample>
            <p>
              圖釘下方的<strong>直線</strong>表示這件事有跨度（戰爭、朝代更迭），線的長度就是持續的年數。
            </p>
          </div>

          <div>
            <Sample height={58}>
              <div className="help-rail r0" aria-hidden="true">
                <span>唐</span>
              </div>
            </Sample>
            <p>
              欄位左側的<strong>背景色帶</strong>是時期或朝代。它是「面」，事件是「點」，
              分開畫兩者才都讀得清楚。
            </p>
          </div>

          <div>
            <Sample height={56}>
              <Mark glyph="政" year="1789" title="法國大革命" imp={5} />
              <Mark glyph="政" year="1804" title="拿破崙稱帝" imp={3} top={30} />
            </Sample>
            <p>
              標題的<strong>字級與粗細代表重要度</strong>。重要度同時決定一則事件要放大到什麼程度才出現。
            </p>
          </div>
        </div>

        <h3>資料與出處</h3>
        <p>
          年代都經維基百科查證（中文版為主，日本史與歐洲史在中文條目過於單薄時另附日文／英文版）。
          標題與描述一律自行撰寫，沒有取用條目文字。點開任一事件都看得到出處連結。
        </p>
        <p>
          <strong>想新增或修改資料</strong>（欄位定義、重要度的給法、出處規則、資料健檢指令）
          請看儲存庫的說明文件，那裡才是唯一的一份：
        </p>
        <p>
          <a className="help-link" href={REPO} target="_blank" rel="noreferrer">
            github.com/kigichang/aoe →
          </a>
        </p>
      </div>
    </div>
  )
}
