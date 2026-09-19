import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
for (const name of ['ir', 'ir-enhanced', 'visible', 'wv', 'radar']) {
  const png = PNG.sync.read(readFileSync(`./sat-${name}.png`))
  const { w, h, data } = png
  let min = 255, max = 0, sum = 0, n = 0
  for (let i = 0; i < w * h; i++) {
    const v = data[i * 4]
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    n++
  }
  console.log(name, 'min', min, 'max', max, 'mean', (sum / n).toFixed(1))
}
