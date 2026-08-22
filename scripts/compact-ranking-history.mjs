import { resolve } from 'node:path'
import { compactRankingHistory } from './lib/ranking-history.mjs'

const root = resolve(import.meta.dirname, '..')
const inputDir = resolve(root, process.argv[2] ?? 'data/rankings')
const outputFile = resolve(root, process.argv[3] ?? 'public/rankings/history.json')

console.log(JSON.stringify(await compactRankingHistory({ inputDir, outputFile }), null, 2))
