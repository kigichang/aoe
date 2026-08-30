import { invoke } from '@tauri-apps/api/core'

/**
 * 效能基準（開發用）。網址帶 `?perf=1` 時，載入後自動：
 *   1. 程式化捲動整條軸（每幀 600px，直到底），記每幀的間隔
 *   2. 連續縮放 12 次（ctrl+wheel 模擬）
 * 統計 avg／p95／最慢一幀，透過 Rust 印到 tauri dev 的 stdout。
 * 搭配 `&virt=0` 可以關掉視窗剔除，兩組數字對照。
 */
export async function runPerf(label: string) {
  const el = document.querySelector<HTMLDivElement>('.scroller')
  if (!el) return
  await new Promise((r) => setTimeout(r, 1500))
  const marks = document.querySelectorAll('.mark, .mark-dot-only').length

  const frames: number[] = []
  const step = (fn: () => boolean) =>
    new Promise<void>((resolve) => {
      let last = performance.now()
      const tick = () => {
        const now = performance.now()
        frames.push(now - last)
        last = now
        if (fn()) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })

  // 捲動
  el.scrollTop = 0
  const scrollFrames = frames.length
  await step(() => {
    el.scrollTop += 300
    return el.scrollTop + el.clientHeight < el.scrollHeight - 1
  })
  const scroll = frames.slice(scrollFrames + 1)

  // 縮放：連發 12 個 ctrl+wheel
  const zoomStart = frames.length
  let n = 0
  await step(() => {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: n % 2 ? 300 : -300, ctrlKey: true, bubbles: true, cancelable: true, clientY: 400 }))
    n++
    return n < 12
  })
  const zoom = frames.slice(zoomStart + 1)

  const stat = (a: number[]) => {
    if (!a.length) return 'n/a'
    const s = [...a].sort((x, y) => x - y)
    const avg = a.reduce((x, y) => x + y, 0) / a.length
    return `n=${a.length} avg=${avg.toFixed(1)}ms p95=${s[Math.floor(s.length * 0.95)].toFixed(1)}ms max=${s[s.length - 1].toFixed(1)}ms >16ms=${a.filter((x) => x > 16.7).length}`
  }
  const text = `[perf ${label}] DOM marks=${marks} | scroll ${stat(scroll)} | zoom ${stat(zoom)}`
  await invoke('log_perf', { text })
}
