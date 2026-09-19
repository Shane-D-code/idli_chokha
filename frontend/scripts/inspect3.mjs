import { readFileSync } from 'node:fs'
const j = JSON.parse(readFileSync('.geo-tmp/admin1_110.geojson', 'utf8'))
const has = Object.fromEntries(['iso_a2','adm0_a3','sov_a3'].map((k) => [k, j.features.filter((f) => f.properties[k] === 'IN').length]))
console.log(has)
const in1 = j.features.find((f) => (f.properties.iso_a2 === 'IN'))
console.log('sample iso_a2 IN:', in1 && in1.properties.name)
const nm = j.features.find((f) => /Rajasthan/.test(f.properties.name || ''))
console.log('rajasthan?', !!nm, nm && nm.properties.iso_a2)
