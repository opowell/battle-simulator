// Internal helper — not meant to be run directly.
// Called by each app's vite.js with { root, port }.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export async function startVite(root, port) {
  const repoRoot = dirname(fileURLToPath(import.meta.url))
  const { createServer } = await import(join(repoRoot, 'node_modules/vite/dist/node/index.js'))
  const server = await createServer({ root, server: { port } })
  await server.listen()
  server.printUrls()
}
