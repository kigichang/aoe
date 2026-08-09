/**
 * 產生 public/ 底下的整組圖示：favicon.svg、favicon.ico、apple-touch-icon.png。
 *
 *   npm run icons
 *
 * ## 為什麼要有這支腳本
 *
 * SVG 是唯一夠用的來源格式（向量、可跟著亮暗色切換），但 Safari 舊版與
 * Windows 工具列還是要 .ico，iOS 加到主畫面要 PNG。手工用外部工具轉一次，
 * 圖形一改就有三份會各自過期 —— 跟 CLAUDE.md 裡「同一段東西存兩份就是遲早
 * 會分岔」是同一個問題。
 *
 * 所以幾何形狀只宣告一次（下面的 ART），SVG 與點陣圖都是從它生出來的。
 * 光柵化器是自己刻的（約 60 行，只需要圓角矩形），這樣就不必為了產圖示
 * 在一個純前端專案裡多裝 sharp / ImageMagick。
 *
 * ## 圖形本身
 *
 * 三條並排的色柱（起訖各不相同，代表各地區的時期）+ 一條橫貫整個圖示的
 * 墨線。那條線就是這個站唯一的承諾：**同一個 y = 同一年，跨欄也成立**
 * （CLAUDE.md 三條不變式的第一條），也就是畫面上的時間游標。
 *
 * 顏色沿用 styles.css 的 --r0 / --r1 / --r2，跟站上「顏色只承載地區」一致。
 *
 * 座標一律用偶數：圖示在 16px 下每個單位剛好是半像素，偶數邊界才不會糊掉。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const OUT = join(resolve(import.meta.dirname, '..'), 'public')

/** 亮色／暗色兩套顏色，值抄自 src/styles.css 的對應 token */
const THEME = {
  light: { tile: '#fcfcfb', ink: '#0b0b0b', r: ['#2a78d6', '#eb6834', '#1baf7a'] },
  dark: { tile: '#1a1a19', ink: '#ffffff', r: ['#3987e5', '#d95926', '#199e70'] },
}

/**
 * 32×32 的座標系，(x, y, w, h, r, 用哪個顏色)。順序就是繪製順序。
 * 色柱寬 4、間距 4；墨線 y=16..18 橫貫滿版。
 */
const ART = [
  { x: 6, y: 4, w: 4, h: 22, r: 2, fill: 'r0' },
  { x: 14, y: 8, w: 4, h: 22, r: 2, fill: 'r1' },
  { x: 22, y: 6, w: 4, h: 16, r: 2, fill: 'r2' },
  { x: 0, y: 16, w: 32, h: 2, r: 0, fill: 'ink' },
]
/** 圓角半徑：瀏覽器分頁上的圖示習慣是圓角方塊；iOS 會自己套遮罩，所以那張不圓角 */
const TILE_R = 7
const UNIT = 32

const color = (theme, key) => (key === 'ink' ? theme.ink : theme.r[+key[1]])

// ---------------------------------------------------------------- SVG

const svg = () => {
  const rect = (s) =>
    `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"` +
    (s.r ? ` rx="${s.r}"` : '') +
    ` class="${s.fill}"/>`
  const vars = (t) =>
    `.tile{fill:${t.tile}}.ink{fill:${t.ink}}` +
    t.r.map((c, i) => `.r${i}{fill:${c}}`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNIT} ${UNIT}">
<title>AoE</title>
<style>${vars(THEME.light)}
@media(prefers-color-scheme:dark){${vars(THEME.dark)}}</style>
<rect width="${UNIT}" height="${UNIT}" rx="${TILE_R}" class="tile"/>
${ART.map(rect).join('\n')}
</svg>
`
}

// ---------------------------------------------------------------- 光柵化

const SS = 8 // 每軸取樣數

/** 畫成 size×size 的 RGBA 像素陣列。tileR=0 用於 apple-touch（iOS 自己會圓角） */
function raster(size, theme, tileR = TILE_R) {
  const n = size * SS
  const k = n / UNIT
  const px = new Float64Array(n * n * 4)

  const fill = (x, y, w, h, r, hex) => {
    const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const x0 = x * k, y0 = y * k, x1 = (x + w) * k, y1 = (y + h) * k
    const rr = Math.min(r * k, (x1 - x0) / 2, (y1 - y0) / 2)
    for (let py = Math.max(0, Math.floor(y0)); py < Math.min(n, Math.ceil(y1)); py++) {
      for (let sx = Math.max(0, Math.floor(x0)); sx < Math.min(n, Math.ceil(x1)); sx++) {
        const cx = sx + 0.5, cy = py + 0.5
        const dx = Math.max(x0 + rr - cx, 0, cx - (x1 - rr))
        const dy = Math.max(y0 + rr - cy, 0, cy - (y1 - rr))
        if (dx * dx + dy * dy > rr * rr) continue
        const o = (py * n + sx) * 4
        px[o] = cr; px[o + 1] = cg; px[o + 2] = cb; px[o + 3] = 255
      }
    }
  }

  fill(0, 0, UNIT, UNIT, tileR, theme.tile)
  for (const s of ART) fill(s.x, s.y, s.w, s.h, s.r, color(theme, s.fill))

  // 超取樣降到目標解析度（premultiply 後平均，邊緣才不會被背景色汙染）
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = ((y * SS + dy) * n + x * SS + dx) * 4
          const al = px[o + 3] / 255
          r += px[o] * al; g += px[o + 1] * al; b += px[o + 2] * al; a += al
        }
      }
      const cnt = SS * SS
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a)
      }
      out[o + 3] = Math.round((a / cnt) * 255)
    }
  }
  return out
}

// ---------------------------------------------------------------- PNG / ICO

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** ICO 容器；每張直接塞 PNG（Vista 之後都吃得下，也省掉 BMP 的上下顛倒） */
function ico(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4)
  let offset = 6 + entries.length * 16
  const dir = []
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16)
    e[0] = size === 256 ? 0 : size
    e[1] = size === 256 ? 0 : size
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12)
    dir.push(e)
    offset += data.length
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)])
}

// ---------------------------------------------------------------- 輸出

// 點陣圖一律用亮色版：分頁列的底色不一定跟系統主題一致，淺色底片在深色分頁上
// 仍然看得清楚，反過來（深色底片在淺色分頁上）就會糊成一團。會跟著主題切換的
// 只有 SVG 那份，而支援 SVG 圖示的瀏覽器本來就是新的那批。
const t = THEME.light

writeFileSync(join(OUT, 'favicon.svg'), svg())
writeFileSync(
  join(OUT, 'favicon.ico'),
  ico([16, 32, 48].map((size) => ({ size, data: png(size, raster(size, t)) }))),
)
writeFileSync(join(OUT, 'apple-touch-icon.png'), png(180, raster(180, t, 0)))

console.log('✓ public/favicon.svg、favicon.ico（16/32/48）、apple-touch-icon.png')
