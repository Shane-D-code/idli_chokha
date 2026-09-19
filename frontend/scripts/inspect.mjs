import { readFileSync } from 'node:fs'
const land110 = JSON.parse(readFileSync('.geo-tmp/land110.geojson', 'utf8'))
const land50 = JSON.parse(readFileSync('.geo-tmp/land50.geojson', 'utf8'))
console.log('110 feature-count', land110.features.length)
console.log('110 f0 geometry', land110.features[0].geometry.type)
console.log('110 polygons', land110.features[0].geometry.coordinates.length)
console.log('110 first poly rings', land110.features[0].geometry.coordinates[0].length)
console.log('110 first ring len', land110.features[0].geometry.coordinates[0][0].length)
console.log('50 feature-count', land50.features.length)
console.log('50 f0 geometry', land50.features[0].geometry.type)
const c0 = land50.features[0].geometry.coordinates
console.log('50 polygons', c0.length, 'first ring len', c0[0][0].length)