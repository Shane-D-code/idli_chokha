import { readFileSync } from 'node:fs'
const j = JSON.parse(readFileSync('.geo-tmp/admin1_110.geojson', 'utf8'))
const props = j.features[0].properties
console.log('fields:', Object.keys(props).slice(0, 40).join(', '))
const india = j.features.filter((f) => f.properties.iso_a1 === 'IN' || f.properties.adm0_a3 === 'IND' || f.properties.admin === 'India' || f.properties.name === 'India')
console.log('india count:', india.length)
console.log('sample india names:', india.slice(0, 5).map((f) => f.properties.name).join(', '))
