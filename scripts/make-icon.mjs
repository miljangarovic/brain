import sharp from 'sharp'
import { readFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build/icon.svg'))

mkdirSync(join(root, 'build'), { recursive: true })
mkdirSync(join(root, 'assets/branding/png'), { recursive: true })

await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(join(root, 'build/icon.png'))
await sharp(svg, { density: 384 }).resize(256, 256).png().toFile(join(root, 'assets/branding/png/terminaltor-256.png'))

console.log('Wrote build/icon.png (512x512) and assets/branding/png/terminaltor-256.png (256x256)')
