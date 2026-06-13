import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { startVite } from '../../_vite.js'

const root = dirname(fileURLToPath(import.meta.url))
const port = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1]
  ?? process.argv[process.argv.indexOf('--port') + 1]) || 5175

await startVite(root, port)
