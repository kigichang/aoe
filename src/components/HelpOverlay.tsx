import { useEffect, useRef } from 'react'
import { CATEGORIES, CATEGORY_IDS, REGIONS, TOPIC } from '../lib/data'
import { fmtYear } from '../lib/scale'
import type { HistEvent } from '../lib/schema'

const REPO = 'https://github.com/kigichang/aoe'

/**
 * 範例用的事件**從當前主題的真實資料挑**，不是寫死的字串。
 *
 * 理由跟「範例用真正的 class 畫」是同一個：寫死的話，世界史的「秦滅六國」
 * 會出現在鐵道史的說明裡。而且挑不到就整格不顯示 —— 沒有傳說事件的主題
 * 本來就不該有一格在教你怎麼讀傳說。
 *
 * 一律依重要度挑最高的那則，結果才穩定（同分再比年份）。
 */
const BY_IMPORTANCE = REGIONS.flatMap((r) => r.events).sort(
  (a, b) => b.importance - a.importance || a.year - b.year,
)

const pick = (pred: (e: HistEvent) => boolean) => BY_IMPORTANCE.find(pred)

const SAMPLES = {
  plain: pick((e) => !e.legendary) ?? BY_IMPORTANCE[0],
  legendary: pick((e) => !!e.legendary),
  /** 引線示範用：低重要度的才是實際上會被推開的那種 */
  minor: pick((e) => e.importance <= 3),
  span: pick((e) => e.endYear !== undefined),
  major: pick((e) => e.importance === 5),
  period: REGIONS.find((r) => r.periods.length > 0)?.periods[0],
}

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
  event,
  top = 2,
}: {
  event: HistEvent
  /** 樣本框內的位置。引線那一條要靠它示範「標籤被推開」 */
  top?: number
}) {
  return (
    <button
      type="button"
      className={`mark imp-${event.importance}${event.legendary ? ' is-legendary' : ''}`}
      style={{ top }}
      tabIndex={-1}
    >
      <span className="glyph" aria-hidden="true">
        {CATEGORIES[event.category].glyph}
      </span>
      <span className="mark-year">{fmtYear(event.year)}</span>
      <span className="mark-title">{event.title}</span>
    </button>
  )
}

interface Props {
  onClose: () => void
}

export function HelpOverlay({ onClose }: Props) {
  /** 欄位在這個主題裡叫什麼（世界史是「地區」，鐵道史可能是「路線」） */
  const col = TOPIC.columnLabel
  const closeRef = useRef<HTMLButtonElement>(null)
  // 開啟前的焦點，關閉時要還回去，鍵盤使用者才不會被丟回頁首
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 標記這次 Esc 已被吃掉，否則詳情面板（掛在 window，比這裡晚跑）
      // 會跟著一起關掉 —— 一次 Esc 只該關最上面那一層。見 DetailPanel。
      e.preventDefault()
      onClose()
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
          每一欄是一個{col}，縱軸是年份。<strong>同一個高度就是同一年</strong>，跨欄也成立 ——
          這是整個網站唯一的承諾，所以刻度是線性的，位置也不會為了排版好看而挪動。
        </p>

        <h3>操作</h3>
        <ul className="help-list">
          <li>
            <kbd>⌘</kbd>／<kbd>Ctrl</kbd> + 滾輪，或左上角 <kbd>＋</kbd> <kbd>−</kbd> 縮放。
          </li>
          <li>右上角的年代按鈕會跳到那一年。</li>
          <li>
            <kbd>⌘K</kbd> 或 <kbd>/</kbd> 開始<strong>搜尋</strong>，可以找標題、描述、年份、
            {col}與類別。<strong>搜尋不會篩掉任何東西</strong> —— 點結果只是跳過去，
            時間軸維持原樣，橫向對照才不會斷掉。若目標的重要度在目前倍率下看不到，
            會自動放大到剛好看得見。
          </li>
          <li>
            上排的圓角標籤是<strong>開關</strong>：{col}、類別{SAMPLES.legendary ? '、傳說' : ''}
            都可以個別關掉。
          </li>
          <li>
            點任何一則事件，右下角會顯示詳情、出處，以及其他{col}的同時期事件。
            按 <kbd>Esc</kbd> 或右上角的 <kbd>×</kbd> 關閉。
          </li>
          <li>
            <strong>網址會跟著你走</strong> —— 捲到哪、縮放多少、選了哪則事件都記在網址列，
            直接複製就能把「這個年代」分享給別人。
          </li>
          <li>
            <strong>縮得越遠，顯示的事件越少</strong> —— 只留下最重要的，否則整條時間軸會擠成一團誰也讀不到。
            覺得某段太空，放大就會逐層出現。
          </li>
        </ul>

        <h3>圖釘怎麼讀</h3>

        <div className="help-rows">
          <div>
            <Sample>
              <Mark event={SAMPLES.plain} />
            </Sample>
            <p>
              圓圈裡的<strong>漢字是類別</strong>，圓圈的<strong>顏色是{col}</strong>（與欄位標題同色）。
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

          {SAMPLES.legendary && (
            <div>
              <Sample height={56}>
                <Mark event={SAMPLES.plain} />
                <Mark event={SAMPLES.legendary} top={30} />
              </Sample>
              <p>
                <strong>實線圈</strong>是有考古或文獻佐證的年代；
                <strong>虛線圈加斜體年份</strong>表示這是<strong>傳說</strong> ——
                年代出自後世追記，不是定年（黃帝、神武天皇、羅馬建城都屬於這類）。
                它們仍然畫在傳世年代的位置上，但視覺上明確標示為不確定。上排的「傳說」可以整組關掉。
              </p>
            </div>
          )}

          <div>
            <Sample height={62}>
              {/* 引線從真實年份（top: 8）拉到被推開的標籤（中心 34） */}
              <div className="leader" style={{ top: 8, height: 26, left: 11 }} />
              <Mark event={SAMPLES.minor ?? SAMPLES.plain} top={23} />
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

          {SAMPLES.span && (
            <div>
              <Sample height={58}>
                <div className="span" style={{ top: 13, height: 34, left: 11 }} />
                <Mark event={SAMPLES.span} top={2} />
              </Sample>
              <p>
                圖釘下方的<strong>直線</strong>表示這件事有跨度（戰爭、朝代更迭），線的長度就是持續的年數。
              </p>
            </div>
          )}

          {SAMPLES.period && (
            <div>
              <Sample height={58}>
                <div className="help-rail r0" aria-hidden="true">
                  {/* 色帶只有 22px 寬，放得下一個字 */}
                  <span>{SAMPLES.period.name[0]}</span>
                </div>
              </Sample>
              <p>
                欄位左側的<strong>背景色帶</strong>是時期或朝代。它是「面」，事件是「點」，
                分開畫兩者才都讀得清楚。
              </p>
            </div>
          )}

          {SAMPLES.major && SAMPLES.minor && (
            <div>
              <Sample height={56}>
                <Mark event={SAMPLES.major} />
                <Mark event={SAMPLES.minor} top={30} />
              </Sample>
              <p>
                標題的<strong>字級與粗細代表重要度</strong>。重要度同時決定一則事件要放大到什麼程度才出現。
              </p>
            </div>
          )}
        </div>

        <h3>資料與出處</h3>
        <p>
          年代都經維基百科查證（中文版為主，中文條目過於單薄時另附該主題母語版，例如日文或英文）。
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
