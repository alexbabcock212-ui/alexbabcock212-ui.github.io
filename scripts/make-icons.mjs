/**
 * Rasterises icons/*.svg into the PNGs the manifest and iOS need.
 *
 * Run once and commit the output — the icons change roughly never, so `sharp`
 * is not kept as a dependency. To regenerate:
 *
 *   npm i -D sharp && node scripts/make-icons.mjs && npm un sharp
 */
import { mkdir, copyFile } from 'node:fs/promises'
import sharp from 'sharp'

const OUT = 'public'

/** Android/Chrome read these; the SVG field already fills the square. */
const FROM_FULL = [64, 192, 512].map((size) => ({ size, name: `pwa-${size}x${size}.png` }))

/** Both of these get masked by the OS, so they use the mark without corner
 *  registration marks — a circular mask would clip them off. */
const FROM_MASKABLE = [
  { size: 512, name: 'maskable-icon-512x512.png' },
  { size: 180, name: 'apple-touch-icon-180x180.png' },
]

async function render(src, { size, name }) {
  await sharp(src, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${name}`)
  console.log(`  ${name}`)
}

await mkdir(OUT, { recursive: true })
console.log('from icons/icon.svg:')
for (const spec of FROM_FULL) await render('icons/icon.svg', spec)
console.log('from icons/icon-maskable.svg:')
for (const spec of FROM_MASKABLE) await render('icons/icon-maskable.svg', spec)

// The full mark doubles as the browser-tab favicon.
await copyFile('icons/icon.svg', `${OUT}/favicon.svg`)
console.log('  favicon.svg')
