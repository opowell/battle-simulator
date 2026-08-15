// Builds the battle-simulator release archives into dist/.
//
//   node scripts/build-release.mjs [options]
//
// The matrix is two independent choices, so a plain run produces six archives:
//
//   server flavour  standalone   runs itself: `node api-server.js`
//                   jas          bundles the JAS server; run `./jas.sh`
//                   source       no server at all — engine, games and UI only
//   dependencies    with-deps    node_modules installed from the lockfile
//                   (default)    no node_modules; the recipient runs npm install
//
// Contents come from `git archive`, so an archive holds exactly what is
// committed at the chosen ref — plus the vendored submodules (the Obscuro
// search and the fog-chess AI), which git archive does not descend into and
// which are unpacked at their pinned commits afterwards.

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const FLAVOURS = ['standalone', 'jas', 'source']
const FORMATS = ['zip', 'tar.gz']
const APP_ID = 'battle-simulator'

// Files the release build strips out of the app tree, per flavour. The source
// flavour loses both halves of the server contract: api-server.js itself, and
// the settings.json that points JAS at it (it would name a file that is gone).
const REMOVE = {
  standalone: [],
  jas: [],
  source: ['api-server.js', 'settings.json'],
}

const parseArgs = (argv) => {
  const args = {
    flavours: FLAVOURS,
    deps: ['with', 'without'],
    out: 'dist',
    ref: 'HEAD',
    format: 'zip',
    chessCache: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split(/=(.*)/s)
    const value = () => (inlineValue !== undefined ? inlineValue : argv[++i])
    if (flag === '--flavours' || flag === '--flavors') args.flavours = value().split(',').map(f => f.trim()).filter(Boolean)
    else if (flag === '--deps') args.deps = value().split(',').map(d => d.trim()).filter(Boolean)
    else if (flag === '--out') args.out = value()
    else if (flag === '--ref') args.ref = value()
    else if (flag === '--format') args.format = value()
    else if (flag === '--with-chess-cache') args.chessCache = true
    else throw new Error('unknown argument: ' + argv[i])
  }
  const unknownFlavour = args.flavours.filter(f => !FLAVOURS.includes(f))
  if (unknownFlavour.length) throw new Error('unknown flavour(s): ' + unknownFlavour.join(', ') + '. Known: ' + FLAVOURS.join(', '))
  const unknownDeps = args.deps.filter(d => !['with', 'without'].includes(d))
  if (unknownDeps.length) throw new Error('unknown --deps value(s): ' + unknownDeps.join(', ') + '. Known: with, without')
  if (!FORMATS.includes(args.format)) throw new Error('unknown format: ' + args.format + '. Known: ' + FORMATS.join(', '))
  return args
}

const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { stdio: 'inherit', ...options })

const capture = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { encoding: 'utf8', ...options }).trim()

const has = (command) => {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

// Relative to the project when it is under it, absolute when --out points
// somewhere else entirely (a ../../../.. chain helps nobody).
const display = (target) => {
  const relative = path.relative(projectRoot, target)
  return relative.startsWith('..') ? target : relative
}

const bytes = (file) => {
  const size = fs.statSync(file).size
  return size >= 1024 ** 2 ? (size / 1024 ** 2).toFixed(1) + ' MB' : Math.round(size / 1024) + ' KB'
}

// --- staging ---------------------------------------------------------------

// git archive stops at submodule boundaries: a submodule is one tree entry in
// the parent, so the checkout comes out empty. Each one is therefore archived
// from its own repository at the commit the parent pins, recursively — the
// fog-chess AI carries its own checkout of the generic search, and nothing
// chess imports resolves without it.
const extractSubmodules = (repoDir, ref, intoDir) => {
  let gitmodules
  try {
    // stderr is swallowed: "no .gitmodules at this ref" is the ordinary way a
    // recursion bottoms out, not a problem worth printing.
    gitmodules = capture('git', ['show', `${ref}:.gitmodules`], { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return // no submodules at this ref
  }
  const paths = [...gitmodules.matchAll(/^\s*path\s*=\s*(.+)$/gm)].map(m => m[1].trim())

  for (const submodulePath of paths) {
    const checkout = path.join(repoDir, submodulePath)
    if (!fs.existsSync(path.join(checkout, '.git'))) {
      throw new Error(
        `submodule ${submodulePath} is not checked out — run:\n` +
        '  git submodule update --init --recursive')
    }
    const pinned = capture('git', ['rev-parse', `${ref}:${submodulePath}`], { cwd: repoDir })
    const destination = path.join(intoDir, submodulePath)
    fs.mkdirSync(destination, { recursive: true })
    const tarball = path.join(intoDir, '.submodule.tar')
    try {
      run('git', ['archive', '--format=tar', '-o', tarball, pinned], { cwd: checkout })
    } catch {
      throw new Error(
        `submodule ${submodulePath} does not have its pinned commit ${pinned.slice(0, 8)} — run:\n` +
        '  git submodule update --init --recursive')
    }
    run('tar', ['-xf', tarball, '-C', destination])
    fs.rmSync(tarball, { force: true })
    extractSubmodules(checkout, pinned, destination)
  }
}

const stageFromGit = (repoDir, ref, stageDir) => {
  fs.rmSync(stageDir, { recursive: true, force: true })
  fs.mkdirSync(stageDir, { recursive: true })
  const tarball = stageDir + '.tar'
  run('git', ['archive', '--format=tar', '-o', tarball, ref], { cwd: repoDir })
  run('tar', ['-xf', tarball, '-C', stageDir])
  fs.rmSync(tarball, { force: true })
}

// The Stockfish evaluation cache is derived data and no longer committed, so it
// never arrives via git archive. It is a large but real speed-up for the chess
// AI, so --with-chess-cache copies whatever this checkout has warmed.
const copyChessCache = (appDir) => {
  const from = path.join(projectRoot, 'games', 'chess', 'vendor')
  const to = path.join(appDir, 'games', 'chess', 'vendor')
  if (!fs.existsSync(to)) return
  // -shm/-wal are sqlite's transient sidecars, meaningless once copied away
  // from the live connection that owns them.
  const files = fs.readdirSync(from).filter(f => /^sf-cache\.(ndjson|sqlite)$/.test(f))
  if (!files.length) {
    console.log('  note: --with-chess-cache, but no warm cache in games/chess/vendor')
    return
  }
  for (const file of files) fs.copyFileSync(path.join(from, file), path.join(to, file))
  console.log('  copied warm chess cache (' + files.join(', ') + ')')
}

const installDeps = (dir) => {
  run(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir })
}

// The with/without-deps split only means anything if the build owns
// node_modules outright, and a git archive can hand one over: JAS commits its
// dependencies deliberately, and this repo still tracks a stray
// node_modules/.package-lock.json. Clear it, then install if asked.
const stripNodeModules = (dir) => {
  fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true })
}

// --- the jas flavour -------------------------------------------------------

// This app normally lives at <jas>/apps/battle-simulator, so the JAS checkout
// is an ancestor of the project — but not at a fixed depth, since a git
// worktree sits several levels down inside .claude/worktrees/. Walk up instead
// of counting directories.
const findJasRoot = () => {
  let dir = projectRoot
  while (true) {
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest) && fs.existsSync(path.join(dir, 'server', 'jas.js'))) {
      try {
        if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name === 'jas') return dir
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// --- assembly --------------------------------------------------------------

const readme = (flavour, version, withDeps) => {
  const install = withDeps
    ? 'Dependencies are included — there is nothing to install.'
    : 'Dependencies are not included. Run `npm install` first (needs network access).'

  // The JAS launcher installs its own dependencies when node_modules is
  // missing, but only its own: the app's are a separate tree it never sees.
  const jasInstall = withDeps
    ? 'Dependencies are included — there is nothing to install.'
    : 'Dependencies are not included. The launcher installs its own on first\n' +
      'run; the app\'s are a separate tree, so install those yourself:\n\n' +
      `    cd apps/${APP_ID} && npm install && cd ../..`

  const body = {
    standalone: `# Battle Simulator ${version} — standalone

${install}

    node api-server.js

Then open the URL it prints (http://localhost:3333 by default). The port comes
from \`--port\`, then \`$PORT\`, then \`settings.json\`.

Requires Node.js 18 or newer. Node 22.5+ additionally enables the sqlite-backed
Stockfish evaluation cache, which makes the fog-chess AI noticeably faster.
`,
    jas: `# Battle Simulator ${version} — JAS bundle

This archive is the JAS app server with Battle Simulator installed as an app.

${jasInstall}

    ./jas.sh          # macOS, Linux
    jas.cmd           REM Windows

Open the URL it prints and pick Battle Simulator from the Launchpad, or go
straight to http://localhost:4500/${APP_ID}. The port lives in
\`server/settings.json\`.

Requires Node.js 20 or newer on PATH. To run without installing Node, drop a
Node runtime into \`server/node/\` — see the JAS release archives, which bundle
one per platform.
`,
    source: `# Battle Simulator ${version} — source

The engine, the game definitions, the agents and the browser UI, with no server
of any kind: \`api-server.js\` and \`settings.json\` are deliberately absent, so
nothing here starts on its own.

${install}

Use it as a library — \`engine/index.js\` is the entry point, \`games/*/index.js\`
are the game definitions — or run a match from the command line:

    node demo/chess-demo.js --auto

For something you can open in a browser, take the \`standalone\` or \`jas\`
archive instead.
`,
  }[flavour]

  return body
}

const archive = (parentDir, folderName, outputFile) => {
  fs.rmSync(outputFile, { force: true })
  if (outputFile.endsWith('.zip')) {
    if (!has('zip')) throw new Error('`zip` is required to build .zip archives (or pass --format tar.gz)')
    run('zip', ['-qry', outputFile, folderName], { cwd: parentDir })
  } else {
    run('tar', ['-czf', outputFile, folderName], { cwd: parentDir })
  }
  console.log('  built ' + display(outputFile) + '  (' + bytes(outputFile) + ')')
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const { version } = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))

  const outDir = path.resolve(projectRoot, args.out)
  const workDir = path.join(outDir, 'work')
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })

  const needsJas = args.flavours.includes('jas')
  const jasRoot = needsJas ? findJasRoot() : null
  if (needsJas && !jasRoot) {
    throw new Error('the jas flavour needs a JAS checkout above this project, and none was found.\n' +
      'Build the other flavours with --flavours standalone,source')
  }

  console.log(`building ${APP_ID} ${version} release archives from ${args.ref}`)

  // One pristine copy of the app tree, cloned per archive so each flavour's
  // deletions and npm install cannot leak into the next.
  const pristine = path.join(workDir, 'pristine')
  console.log('staging the app tree')
  stageFromGit(projectRoot, args.ref, pristine)
  extractSubmodules(projectRoot, args.ref, pristine)
  stripNodeModules(pristine)
  if (args.chessCache) copyChessCache(pristine)

  let jasPristine = null
  if (needsJas) {
    console.log('staging the JAS server from ' + jasRoot)
    jasPristine = path.join(workDir, 'pristine-jas')
    stageFromGit(jasRoot, 'HEAD', jasPristine)
    extractSubmodules(jasRoot, 'HEAD', jasPristine)
    stripNodeModules(jasPristine)
  }

  for (const flavour of args.flavours) {
    for (const deps of args.deps) {
      const withDeps = deps === 'with'
      const folderName = `${APP_ID}-${version}`
      const suffix = `${flavour}-${withDeps ? 'with-deps' : 'no-deps'}`
      console.log(`\n${suffix}:`)

      const buildDir = path.join(workDir, suffix)
      fs.rmSync(buildDir, { recursive: true, force: true })
      fs.mkdirSync(buildDir, { recursive: true })

      const root = path.join(buildDir, folderName)
      // In the jas flavour the archive root is the JAS server and the app
      // moves under apps/; otherwise the app tree is the archive root.
      const appDir = flavour === 'jas' ? path.join(root, 'apps', APP_ID) : root

      if (flavour === 'jas') {
        fs.cpSync(jasPristine, root, { recursive: true })
        fs.mkdirSync(path.dirname(appDir), { recursive: true })
      }
      fs.cpSync(pristine, appDir, { recursive: true })

      for (const relative of REMOVE[flavour]) {
        fs.rmSync(path.join(appDir, relative), { recursive: true, force: true })
      }

      fs.writeFileSync(path.join(root, 'README-RELEASE.md'), readme(flavour, version, withDeps))

      if (withDeps) {
        console.log('  installing dependencies')
        installDeps(appDir)
        // The JAS server has its own (express); an app's node_modules is not
        // on its resolution path.
        if (flavour === 'jas') installDeps(root)
      }

      archive(buildDir, folderName, path.join(outDir, `${APP_ID}-${version}-${suffix}.${args.format}`))
      fs.rmSync(buildDir, { recursive: true, force: true })
    }
  }

  fs.rmSync(workDir, { recursive: true, force: true })
  console.log('\ndone. Archives are in ' + display(outDir) + '/')
}

main().catch(error => {
  console.error('build-release: ' + error.message)
  process.exit(1)
})
