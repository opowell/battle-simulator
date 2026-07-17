#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Standalone trainer for learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md).
// Regenerates value models for any or all games with NO other tooling:
//
//   node agents/learned/train.mjs --game tactical
//   node agents/learned/train.mjs --all                # every non-deferred game
//   node agents/learned/train.mjs --all --force        # retrain even if a model exists
//
// Pipeline per game (all pure Node, minutes per game by default):
//   1. SELF-PLAY DATA: headless games (mix of random-vs-random and
//      light-Obscuro-vs-random; later generations use the current net) with
//      every ply labeled by the final outcome from players[0]'s view
//      (truncated games: discounted static-eval margin).
//   2. TRAIN: antisymmetric-pair MLP (agents/learned/mlp.js) by Adam/MSE.
//   3. GATE: learned-eval Obscuro vs static-eval Obscuro over --gate-games
//      (colors alternate). The model is written to games/<game>/model.json
//      ONLY if it scores ≥ --gate (default 0.55) — otherwise the game keeps
//      its hand heuristic and this run leaves no trace (report aside).
//
// Flags (defaults in brackets):
//   --game <name>        train one game            --all        train the roster
//   --games N [300]      self-play games per generation
//   --gens N [2]         generations (later gens self-play with the current net)
//   --gate-games N [120] gate match length         --gate F [0.55]
//   --agent-ms N [80]    per-move search budget in data-gen/gate matches
//   --max-plies N [160]  hard game-length cap
//   --epochs N [30]      training epochs per generation
//   --seed N [7]         master seed               --force      retrain existing
//   --include-deferred   also run risk/kdice/civ1/civ2 with --all
//   --dry                run everything but never write model.json
// ---------------------------------------------------------------------------

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MLP } from './mlp.js';
import { encodeState, opponentOf, ENCODER_VERSION, INPUT_SIZE } from './encoder.js';
import { wireNet } from './leafEval.js';
import { ObscuroAgent } from '../ObscuroAgent.js';
import { RandomAgent } from '../RandomAgent.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_DIR = path.join(HERE, '..', '..', 'games');

// Roster: game name → module dir + export. Deferred games (multiplayer head /
// truncation-dominated labels — see the plan) are skipped by --all but can be
// trained explicitly with --game.
const ROSTER = {
  tactical: 'TacticalGame', ffta: 'FFTAGame', doom: 'DoomGame', xcom: 'XComGame',
  cardbattle: 'CardBattleGame', mudandblood: 'MudAndBloodGame', sc1: 'Sc1Game',
  sc2: 'Sc2Game', cs: 'CsGame', combatmission: 'CombatMissionGame', aow: 'AowGame',
  risk: 'RiskGame', kdice: 'KDiceGame', civ1: 'Civ1Game', civ2: 'Civ2Game',
};
const DEFERRED = new Set(['risk', 'kdice', 'civ1', 'civ2']);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv) {
  const o = {
    game: null, all: false, games: 200, gens: 2, gateGames: 100, gate: 0.55,
    agentMs: 60, maxPlies: 120, epochs: 30, seed: 7, force: false,
    includeDeferred: false, dry: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--game') o.game = argv[++i];
    else if (a === '--all') o.all = true;
    else if (a === '--games') o.games = Number(argv[++i]);
    else if (a === '--gens') o.gens = Number(argv[++i]);
    else if (a === '--gate-games') o.gateGames = Number(argv[++i]);
    else if (a === '--gate') o.gate = Number(argv[++i]);
    else if (a === '--agent-ms') o.agentMs = Number(argv[++i]);
    else if (a === '--max-plies') o.maxPlies = Number(argv[++i]);
    else if (a === '--epochs') o.epochs = Number(argv[++i]);
    else if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--force') o.force = true;
    else if (a === '--include-deferred') o.includeDeferred = true;
    else if (a === '--dry') o.dry = true;
    else { console.error(`unknown flag ${a}`); process.exit(1); }
  }
  if (!o.game && !o.all) { console.error('usage: train.mjs --game <name> | --all  [flags]'); process.exit(1); }
  return o;
}

// --- headless game loop -------------------------------------------------------

// Play one game with per-player agents; returns { result, states } where
// states[i] = the true state at ply i (before that ply's actions).
async function playGame(game, agents, rng, maxPlies, onPly) {
  const players = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
  let state = game.createInitialState(players, {});
  let result = null;
  for (let ply = 0; ply < maxPlies; ply++) {
    result = game.getResult(state);
    if (result) break;
    const active = state.activePlayers ?? [];
    if (!active.length) break;
    const playerActions = [];
    for (const pid of active) {
      const legal = game.getLegalActions(state, pid) ?? [];
      if (!legal.length) continue;
      const view = game.getVisibleState ? game.getVisibleState(state, pid) : state;
      const action = await agents[pid].chooseAction(view, legal, game);
      if (action) playerActions.push({ playerId: pid, action });
    }
    if (!playerActions.length) break; // nobody can move — avoid an infinite loop
    if (onPly) onPly(state);
    try { state = game.applyActions(state, playerActions, rng); } catch { break; }
  }
  return { result: result ?? game.getResult(state), finalState: state };
}

// Outcome for p1 in [−1, +1]; truncated/aborted games get a discounted
// static-eval margin (the hand heuristic is the neutral adjudicator).
function outcomeZ(game, result, finalState) {
  if (result?.outcome === 'win') return result.winnerId === 'p1' ? 1 : -1;
  if (result?.outcome === 'draw') return 0;
  const evalFn = game.staticEvaluateState ?? game.evaluateState;
  try {
    const m = evalFn(finalState, 'p1');
    return 0.3 * Math.sign(m || 0);
  } catch { return 0; }
}

function makeAgents(game, kind, rng, agentMs) {
  const mk = (which) => which === 'random'
    ? { chooseAction: (view, legal) => RandomAgent.chooseAction(view, legal, game) }
    : new ObscuroAgent(game, { rng, particles: 4, timeBudgetMs: agentMs, maxRounds: 20, finalCfr: 20 });
  if (kind === 'rr') return { p1: mk('random'), p2: mk('random') };
  if (kind === 'or') return rng() < 0.5
    ? { p1: mk('obscuro'), p2: mk('random') }
    : { p1: mk('random'), p2: mk('obscuro') };
  return { p1: mk('obscuro'), p2: mk('obscuro') };
}

// ε-greedy wrapper for data diversity.
function withEpsilon(agent, game, rng, eps) {
  return {
    chooseAction: async (view, legal, g) => {
      if (rng() < eps) return legal[Math.floor(rng() * legal.length)];
      return agent.chooseAction(view, legal, g ?? game);
    },
  };
}

// --- per-game pipeline ---------------------------------------------------------

async function generateData(game, playGame_, net, opts, rng) {
  const samples = [];
  const genGame = net ? wireNet({ ...game }, net) : game;
  for (let g = 0; g < opts.games; g++) {
    // Half fast random-vs-random for coverage, half with a (light) searcher for
    // quality; ε keeps openings diverse.
    const kind = g % 2 === 0 ? 'rr' : 'or';
    const base = makeAgents(genGame, kind, rng, opts.agentMs);
    const agents = {
      p1: withEpsilon(base.p1, genGame, rng, 0.15),
      p2: withEpsilon(base.p2, genGame, rng, 0.15),
    };
    const perGame = [];
    const { result, finalState } = await playGame_(genGame, agents, rng, opts.maxPlies, (state) => {
      const opp = opponentOf(state, 'p1') ?? 'p2';
      perGame.push({
        xa: encodeState(game, state, 'p1'),
        xb: encodeState(game, state, opp),
      });
    });
    const z = outcomeZ(game, result, finalState);
    for (const s of perGame) samples.push({ xa: s.xa, xb: s.xb, z });
  }
  return samples;
}

function trainNet(net, samples, opts, rng) {
  const BATCH = 64;
  let lastLoss = NaN;
  for (let e = 0; e < opts.epochs; e++) {
    // shuffle
    for (let i = samples.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [samples[i], samples[j]] = [samples[j], samples[i]];
    }
    let loss = 0, nb = 0;
    for (let i = 0; i + 1 < samples.length; i += BATCH) {
      loss += net.trainPairs(samples.slice(i, i + BATCH), 1e-3);
      nb++;
    }
    lastLoss = loss / Math.max(1, nb);
  }
  return lastLoss;
}

// Gate: learned vs static Obscuro, colors alternating. Returns score ∈ [0,1]
// for the learned side (draws and adjudicated games count by margin sign).
//
// Both sides get the SAME small ε of random moves. Without it, searcher-vs-
// searcher games in attrition games (e.g. tactical under a material eval) can
// stall forever in mutual avoidance — every game truncates at margin 0 and the
// gate pins at exactly 50% no matter how good the candidate eval is. Symmetric
// noise forces skirmishes; converting them better is exactly what a stronger
// evaluator should demonstrate.
async function gateMatch(game, net, opts, rng) {
  const learnedGame = wireNet({ ...game }, net);
  const staticGame = { ...game };
  const GATE_EPS = 0.05;
  let score = 0;
  for (let g = 0; g < opts.gateGames; g++) {
    const learnedIsP1 = g % 2 === 0;
    const mk = (gm) => withEpsilon(
      new ObscuroAgent(gm, { rng, particles: 4, timeBudgetMs: opts.agentMs, maxRounds: 20, finalCfr: 20 }),
      gm, rng, GATE_EPS);
    const agents = {
      p1: mk(learnedIsP1 ? learnedGame : staticGame),
      p2: mk(learnedIsP1 ? staticGame : learnedGame),
    };
    const { result, finalState } = await playGame(game, agents, rng, opts.maxPlies, null);
    let zP1; // p1's score in [0,1]
    if (result?.outcome === 'win') zP1 = result.winnerId === 'p1' ? 1 : 0;
    else if (result?.outcome === 'draw') zP1 = 0.5;
    else {
      const evalFn = game.staticEvaluateState ?? game.evaluateState;
      let m = 0; try { m = evalFn(finalState, 'p1') || 0; } catch { /* 0 */ }
      zP1 = m > 0 ? 0.75 : m < 0 ? 0.25 : 0.5; // soft adjudication
    }
    score += learnedIsP1 ? zP1 : 1 - zP1;
    if ((g + 1) % 25 === 0) console.log(`[gate] ${g + 1}/${opts.gateGames} games, learned ${(100 * score / (g + 1)).toFixed(1)}% so far`);
  }
  return score / opts.gateGames;
}

async function trainGame(name, opts) {
  const exportName = ROSTER[name];
  if (!exportName) { console.error(`unknown game '${name}' (roster: ${Object.keys(ROSTER).join(', ')})`); return null; }
  const modelPath = path.join(GAMES_DIR, name, 'model.json');
  if (!opts.force && existsSync(modelPath)) {
    try {
      const existing = JSON.parse(readFileSync(modelPath, 'utf8'));
      if (existing.encoderVersion === ENCODER_VERSION) {
        console.log(`[${name}] model exists (gate ${existing.gate?.score?.toFixed?.(3)}); use --force to retrain`);
        return existing;
      }
    } catch { /* corrupt — retrain */ }
  }
  const mod = await import(path.join(GAMES_DIR, name, 'index.js'));
  const game = mod[exportName];
  if (!game?.evaluateState) { console.error(`[${name}] no evaluateState — skipped`); return null; }
  // Train against the PRISTINE definition even if a previous model was
  // installed at import time.
  const base = { ...game };
  if (base.staticEvaluateState) {
    base.evaluateState = base.staticEvaluateState;
    delete base.evaluateLeaves; delete base.winValue;
  }

  const rng = mulberry32(opts.seed * 7919 + name.length);
  const t0 = Date.now();
  let net = new MLP([INPUT_SIZE, 64, 32, 1], opts.seed);
  const buffer = [];
  let loss = NaN;
  for (let gen = 0; gen < opts.gens; gen++) {
    const samples = await generateData(base, playGame, gen === 0 ? null : net, opts, rng);
    buffer.push(...samples);
    while (buffer.length > 120000) buffer.shift();
    loss = trainNet(net, buffer, opts, rng);
    console.log(`[${name}] gen ${gen + 1}/${opts.gens}: +${samples.length} samples (buffer ${buffer.length}), loss ${loss.toFixed(4)}`);
  }
  const score = await gateMatch(base, net, opts, rng);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  const passed = score >= opts.gate;
  console.log(`[${name}] GATE: learned scored ${(100 * score).toFixed(1)}% over ${opts.gateGames} games — ${passed ? 'PASS' : 'FAIL'} (threshold ${100 * opts.gate}%), ${elapsed}s total`);
  const spec = {
    game: name,
    encoderVersion: ENCODER_VERSION,
    trainedAt: new Date().toISOString(),
    config: { games: opts.games, gens: opts.gens, epochs: opts.epochs, agentMs: opts.agentMs, seed: opts.seed },
    gate: { score, games: opts.gateGames, threshold: opts.gate, passed },
    trainLoss: loss,
    net: net.toJSON(),
  };
  if (passed && !opts.dry) {
    writeFileSync(modelPath, JSON.stringify(spec));
    console.log(`[${name}] wrote ${path.relative(process.cwd(), modelPath)}`);
  } else if (!passed) {
    console.log(`[${name}] model NOT written — game keeps its hand heuristic`);
  }
  return spec;
}

const opts = parseArgs(process.argv);
const names = opts.all
  ? Object.keys(ROSTER).filter(n => opts.includeDeferred || !DEFERRED.has(n))
  : [opts.game];
const summary = [];
for (const name of names) {
  try {
    const spec = await trainGame(name, opts);
    summary.push({ name, score: spec?.gate?.score, passed: spec?.gate?.passed });
  } catch (e) {
    console.error(`[${name}] FAILED: ${e?.message ?? e}`);
    summary.push({ name, error: String(e?.message ?? e) });
  }
}
console.log('\n=== summary ===');
for (const s of summary) {
  console.log(`${s.name.padEnd(14)} ${s.error ? 'ERROR: ' + s.error : s.score == null ? 'skipped/existing' : `${(100 * s.score).toFixed(1)}% ${s.passed ? 'PASS' : 'FAIL'}`}`);
}
process.exit(0);
