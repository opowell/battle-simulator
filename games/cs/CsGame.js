import { csEvaluate } from './eval.js';
// The CS-specialised Obscuro agent, declared in `agents` below. It lazily imports
// CsGame back (inside a method, like chess's) so this import stays acyclic.
import { ObscuroAgent as CsObscuroAgent, analyzeCsObscuro } from './ObscuroAgent.js';
import {
  WEAPONS, GRENADES, EQUIPMENT,
  ARMOR_COST, ARMOR_HP, ARMOR_REDUCTION, HELMET_EXTRA_REDUCTION, CROUCH_DAMAGE_REDUCTION,
  STARTING_MONEY, WIN_REWARD, KILL_REWARD, MAX_MONEY, lossReward,
  GRENADE_THROW_RANGE, HE_RADIUS, HE_DAMAGE,
  FLASH_RADIUS, FLASH_BLIND_TURNS,
  SMOKE_RADIUS, SMOKE_TURNS, smokeOval,
  FIRE_RADIUS, FIRE_DAMAGE, FIRE_TURNS,
  BOMB_TIMER, DEFUSE_NEEDED, ROUND_TURN_MAX,
} from './weapons.js';
import {
  MAPS,
  isBombsite, euclidean, getReachable, renderMap,
  isWalkableContinuous, isPathClearContinuous,
} from './map.js';
import { getCsBelief, CS_VISION, csVisionCfg, csLosLayers, csHasLOS } from './belief.js';
import { isClearOfUnits, latticeActions } from '../continuousMove.js';
import { filterVisibleUnits, orientToEnemies } from '../vision.js';
import { makePos, parsePos, num, tileNum, posToWire } from '../coord.js';
import { MAP_ZOOM_OPTION } from '../renderOptions.js';


const MOVE_RANGE     = 8; // per-turn move allowance (budget, not a single-move cap) — see perTurn.moveAllowance; doubled alongside the 3x map/vision resize (2026-07-17)
// Smallest move that actually counts as moving. A unit's move budget is a float64 that shrinks
// by the exact (continuous) distance travelled, so it routinely lands on a tiny positive residue
// (e.g. 1e-16) after a near-full move. Without a floor, that residue is still "> 0", so the unit
// is still offered moves — and the AI's search lattice, sized to a ~1e-16 range, produces points
// that round right back onto the unit's own position: a zero-distance "move" that is legal, costs
// no budget, and never sets hasActed, so the turn loops forever ("AI thinking…"). Requiring every
// move to cover at least MOVE_EPS makes each accepted move strictly spend budget, so a turn always
// runs out of moves and ends. It's far below any tactically meaningful step (units sit ~0.4 apart).
const MOVE_EPS       = 0.05;
// BOMB_TIMER / DEFUSE_NEEDED / ROUND_TURN_MAX now live in weapons.js (imported above)
// so eval.js can price the bomb timer and round clock without a circular import.
// Hard cap on how many items one unit may buy in a single buy phase. Each buy is its own
// engine step (and, for an AI player, a full move search), so an unbounded buy phase is what
// froze the game: an AI that assigns no value to unspent money will buy everything it can
// afford, and with a big late-game wallet that ran to ~100 sequential searches per buy phase.
// A cap of 6 still allows a full realistic loadout (primary + armor + helmet + defuse kit + a
// couple of grenades) while bounding the buy phase to a handful of steps per unit no matter how
// rich the unit is or how many buyable items exist. Resets every round (units respawn fresh).
const MAX_BUYS_PER_ROUND = 6;

// Crouching (see the 'crouch'/'stand' actions below): a stance toggle that trades move speed
// for a smaller, harder-to-hit silhouette and a shorter sight line. It doesn't consume the
// per-turn action gate (hasActed) — a unit can still shoot/reload/throw/plant/defuse the same
// turn it toggles stance — only movement and vision are affected.
const CROUCH_MOVE_MULT        = 0.5;  // crouched move allowance, applied on the unit's next turn
const CROUCH_VISION_MULT      = 0.7;  // crouched sight radius, relative to CS_VISION.range

// A unit carries up to three weapons at once — a sidearm, a knife, and a primary — but only
// one is drawn ('active') at a time; switching costs a small chunk of the move budget rather
// than the whole turn (see the 'switch-weapon' action below), so a unit can reposition and
// swap weapons in the same turn but not infinitely. Move speed depends on what's drawn: knife
// fastest, pistol baseline (matches the old flat MOVE_RANGE), a primary slowest.
const SWITCH_WEAPON_COST = 1;  // flat moveAllowance tax for a 'switch-weapon' action
const ROTATE_COST = 1;  // flat moveAllowance tax for a 'rotate' action (turn in place, no move)
// Flat moveAllowance tax for a 'crouch'/'stand' stance change, for exactly the same
// reason rotate and switch-weapon carry one: an action that is neither gated by
// hasActed nor priced in budget can be repeated forever. Stance was the one such
// action left untaxed, and it is a TOGGLE, so crouch→stand→crouch→… was a
// zero-cost cycle that returned to the identical state. Any search that values a
// position at all will happily sit in that loop rather than end its turn (ending
// hands the opponent a move, which scores as the negation of our own value), so
// the AI's turn never terminated: thousands of engine steps per turn, rounds
// frozen, matches unable to finish. Taxing it bounds stance changes per turn the
// same way every other repeatable action is bounded.
const STANCE_COST = 1;
const SLOT_MOVE_MULT = { melee: 1.25, pistol: 1.0, primary: 0.7 };
// Which loadout slot a WEAPONS category belongs in — every non-melee, non-pistol category
// (smg/shotgun/rifle/heavy/sniper) shares the single 'primary' slot.
const WEAPON_SLOT = category => category === 'pistol' ? 'pistol' : category === 'melee' ? 'melee' : 'primary';

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcDamage(raw, unit) {
  let reduction = 0;
  if (unit.armor) reduction += ARMOR_REDUCTION + (unit.helmet ? HELMET_EXTRA_REDUCTION : 0);
  if (unit.crouched) reduction += CROUCH_DAMAGE_REDUCTION;
  return Math.round(raw * (1 - reduction));
}

// Blast/effect radius shown as an aim preview when throwing (see toGrid's throw
// action + the design UI's aiming overlay). Decoy has no area effect.
function grenadeBlastRadius(gid) {
  if (gid === 'he') return HE_RADIUS;
  if (gid === 'flash') return FLASH_RADIUS;
  if (gid === 'smoke') return SMOKE_RADIUS;
  if (gid === 'molotov' || gid === 'incendiary') return FIRE_RADIUS;
  return 0;
}

// What the design UI's aiming overlay should preview for each unit caught in the
// blast, while a throw is being aimed (see the 'throw' action's blastRadius above):
// 'damage' shows an estimated hp loss (matches applyActions' HE branch, which hits
// both teams), 'blind' flags the flashbang's blind-the-enemy effect (no damage
// number), 'none' covers zone effects (smoke/fire) with no instant per-unit outcome.
function grenadePreview(gid) {
  if (gid === 'he') return { previewKind: 'damage', damage: HE_DAMAGE };
  if (gid === 'flash') return { previewKind: 'blind' };
  return { previewKind: 'none' };
}

// Zone centres can be continuous (a grenade thrown to an exact point); the tile-key
// membership sets they feed are integer-keyed, so snap each centre to its tile.
function buildFireSet(fireZones) {
  const s = new Set();
  for (const fz of fireZones) {
    const cx = tileNum(fz.x), cy = tileNum(fz.y);
    for (let dy = -FIRE_RADIUS; dy <= FIRE_RADIUS; dy++)
      for (let dx = -FIRE_RADIUS; dx <= FIRE_RADIUS; dx++)
        s.add(`${cx + dx},${cy + dy}`);
  }
  return s;
}

// ── Unit factory ──────────────────────────────────────────────────────────────

function fullAmmo(weaponId) {
  const w = WEAPONS[weaponId];
  return { mag: w.magSize, reserve: w.reserve };
}

// Player-model factions (see counterstrike.fandom.com's "List of factions") — purely
// cosmetic, cycled deterministically per spawn index so a squad shows visual variety
// without adding non-determinism to game state.
const FACTIONS = {
  T:  ['arctic', 'leet', 'guerilla', 'phoenix'],
  CT: ['gign', 'gsg9', 'sas', 'seal'],
};

const FACTION_NAMES = {
  arctic: 'Arctic Avengers', leet: 'Elite Crew', guerilla: 'Guerilla Warfare', phoenix: 'Phoenix Connexion',
  gign: 'GIGN', gsg9: 'GSG-9', sas: 'SAS', seal: 'SEAL Team 6',
};

function makeUnit(id, ownerId, pos, faction) {
  return {
    id, ownerId, type: WEAPONS.pistol.category, faction,
    position: makePos(pos.x, pos.y),
    alive: true,
    hp: 100, maxHp: 100,
    money: STARTING_MONEY,   // per-unit wallet (CS money is per-player, not a team pool)
    armor: 0, helmet: false, hasKit: false,
    // Three-slot loadout (see WEAPON_SLOT/SLOT_MOVE_MULT above): every unit always owns a
    // pistol and a knife, `primary` fills in once bought. `active` is which one is drawn —
    // only the active weapon can fire, reload, or render on the map.
    weapons: { pistol: 'pistol', melee: 'knife', primary: null },
    active: 'pistol',
    ammo: { pistol: fullAmmo('pistol') },
    grenades: {},
    blinded: 0,
    crouched: false,
    // moveAllowance depletes by distance moved (see applyActions' 'move' branch) and can be
    // spent across any number of moves per turn, unlike hasActed's one-shot gate.
    perTurn: { hasActed: false, moveAllowance: MOVE_RANGE },
  };
}

function spawnUnits(map) {
  // Orient each side toward the enemy at spawn so vision cones point across the map from
  // turn 1; facing then follows movement (see the move handler and games/vision.js).
  return orientToEnemies([
    ...map.tSpawns.map((p, i)  => makeUnit(`T-${i}`,  'T',  p,  FACTIONS.T[i % FACTIONS.T.length])),
    ...map.ctSpawns.map((p, i) => makeUnit(`CT-${i}`, 'CT', p, FACTIONS.CT[i % FACTIONS.CT.length])),
  ], p => [num(p.x), num(p.y)]);
}

// Weapon/equipment icons (see counterstrike.fandom.com's "List of weapons" and "List
// of equipment") — every WEAPONS/GRENADES key plus armor/helmet/defusekit has a
// same-named file in games/cs/images/weapons/.
const WEAPON_ICON = w => `/images/cs/weapons/${w}`;

// ── Map sprite: body + hands + held weapon, all flat-color primitives — surviv.io's look
// (see apps/design/SchematicLayer.vue's generic `unit.spriteLayers` renderer, whose `shape:
// 'circle'|'rect'` layers draw fill/stroke primitives instead of sourced art). All offsets
// below are LOCAL (unrotated, facing = +x), in multiples of unitR(u); the game precomputes
// the facing-rotated world offset so the renderer stays a dumb draw loop.
const TEAM_COLOR = { CT: '#5b7fb0', T: '#b0824a' };
const SKIN_COLOR = '#dba573';
// Weapon silhouette (a simple grip-to-muzzle bar) sized by category — length/width in unitR.
const CATEGORY_GUN = {
  melee:   { len: 0.55, wid: 0.16 },
  pistol:  { len: 0.85, wid: 0.22 },
  smg:     { len: 1.05, wid: 0.26 },
  shotgun: { len: 1.00, wid: 0.30 },
  rifle:   { len: 1.35, wid: 0.26 },
  heavy:   { len: 1.50, wid: 0.32 },
  sniper:  { len: 1.65, wid: 0.22 },
};

function rot2(lx, ly, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return { dx: lx * c - ly * s, dy: lx * s + ly * c };
}

// How much thicker the body's own outline gets when armored, and how much that widens the
// unit's clickable hit-area (see SchematicLayer.vue's `u.hitRFrac`) so the thicker edge stays selectable.
const ARMOR_STROKE_WIDTH = 5;
const ARMOR_HIT_RFRAC    = 1.08;

function spriteLayers(u) {
  const rad  = u.facing ?? 0;
  const deg  = rad * 180 / Math.PI;
  const teamColor = TEAM_COLOR[u.ownerId] ?? TEAM_COLOR.CT;
  // Only the currently drawn weapon renders — a holstered pistol/primary is carried but
  // not shown (matches surviv.io, where only the active weapon appears in-hand).
  const gun  = CATEGORY_GUN[WEAPONS[u.weapons[u.active]]?.category] ?? CATEGORY_GUN.pistol;
  // Gun starts near the body edge and runs forward past the hands, so the muzzle stays
  // visible beyond the grip regardless of weapon length; hands stay clustered at the grip
  // (fixed spread, not scaled by gun.len) rather than spanning the whole barrel.
  const gunPos    = rot2(0.15, 0, rad);
  const backHand  = rot2(0.30, 0.22, rad);
  const frontHand = rot2(0.55, -0.22, rad);
  const layers = [
    // Armored units get a thicker body outline (like a plate-carrier silhouette) instead of
    // a separate badge layer — see ARMOR_STROKE_WIDTH/ARMOR_HIT_RFRAC above.
    { shape: 'circle', rFrac: 1.0, fill: teamColor, stroke: '#20242c',
      strokeWidth: u.armor ? ARMOR_STROKE_WIDTH : 2, dx: 0, dy: 0, rot: 0 },
  ];
  if (u.helmet) {
    const p = rot2(0.4, 0, rad);
    layers.push({ shape: 'circle', rFrac: 0.4, fill: '#4b5563', stroke: '#20242c', strokeWidth: 1.5, dx: p.dx, dy: p.dy, rot: 0 });
  }
  layers.push(
    { shape: 'rect', wFrac: gun.len, hFrac: gun.wid, anchorX: 0, anchorY: 0.5, rxFrac: 0.15,
      fill: '#2a2a2a', stroke: '#0e0f12', strokeWidth: 1, dx: gunPos.dx, dy: gunPos.dy, rot: deg },
    { shape: 'circle', rFrac: 0.24, fill: SKIN_COLOR, stroke: '#20242c', strokeWidth: 1, dx: backHand.dx, dy: backHand.dy, rot: 0 },
    { shape: 'circle', rFrac: 0.26, fill: SKIN_COLOR, stroke: '#20242c', strokeWidth: 1, dx: frontHand.dx, dy: frontHand.dy, rot: 0 },
  );
  return layers;
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function buyActions(state, teamId) {
  const myUnits = state.units.filter(u => u.alive && u.ownerId === teamId);
  const actions = [];

  for (const u of myUnits) {
    // Stop offering buys to a unit that has already bought its allotment this round — keeps the
    // buy phase bounded to a few steps per unit (see MAX_BUYS_PER_ROUND).
    if ((u.buysThisRound ?? 0) >= MAX_BUYS_PER_ROUND) continue;
    const money = u.money;   // each player buys from their own wallet, not a shared pool
    // Weapons: a unit upgrades its pistol slot and fills its primary slot ONCE EACH per buy
    // phase (two slot-scoped gates below), not once total — a unit can own both a better
    // sidearm and a primary. Offering a weapon buy whenever the slot's current occupant could
    // be replaced (as opposed to gating on "still holding the free default") let a unit swap
    // guns every step — and since the AI places no value on saving money, it bought and
    // re-bought weapons until its wallet drained, stretching one buy phase to hundreds of
    // engine steps, each a full AI search, so the game froze ("AI thinking…") for minutes once
    // late-game wallets grew. Gating each slot on "still holding its free/empty default" caps
    // weapon buys at two per unit (one pistol + one primary), so the buy phase stays short and
    // bounded regardless of how much money a unit is holding.
    if (u.weapons.pistol === 'pistol') {
      for (const [wid, w] of Object.entries(WEAPONS)) {
        if (w.category !== 'pistol' || wid === 'pistol') continue;
        if (w.teams && !w.teams.includes(teamId)) continue;
        if (w.cost <= money)
          actions.push({ type: 'buy', unitId: u.id, item: wid, name: `${w.name} ($${w.cost})`, icon: WEAPON_ICON(wid) });
      }
    }
    if (!u.weapons.primary) {
      for (const [wid, w] of Object.entries(WEAPONS)) {
        if (w.category === 'pistol' || w.category === 'melee') continue;
        if (w.teams && !w.teams.includes(teamId)) continue;
        if (w.cost <= money)
          actions.push({ type: 'buy', unitId: u.id, item: wid, name: `${w.name} ($${w.cost})`, icon: WEAPON_ICON(wid) });
      }
    }
    // Armor (kevlar)
    if (!u.armor && ARMOR_COST <= money)
      actions.push({ type: 'buy', unitId: u.id, item: 'armor', name: `Kevlar Armor ($${ARMOR_COST})`, icon: WEAPON_ICON('armor') });
    // Helmet (requires armor)
    if (u.armor && !u.helmet && EQUIPMENT.helmet.cost <= money)
      actions.push({ type: 'buy', unitId: u.id, item: 'helmet', name: `${EQUIPMENT.helmet.name} ($${EQUIPMENT.helmet.cost})`, icon: WEAPON_ICON('helmet') });
    // Defuse kit (CT only)
    if (!u.hasKit && teamId === 'CT' && EQUIPMENT.defusekit.cost <= money)
      actions.push({ type: 'buy', unitId: u.id, item: 'defusekit', name: `${EQUIPMENT.defusekit.name} ($${EQUIPMENT.defusekit.cost})`, icon: WEAPON_ICON('defusekit') });
    // Grenades
    for (const [gid, g] of Object.entries(GRENADES)) {
      if (g.teams && !g.teams.includes(teamId)) continue;
      if (g.cost <= money && (u.grenades[gid] ?? 0) < g.maxStack)
        actions.push({ type: 'buy', unitId: u.id, item: gid, name: `${g.name} ($${g.cost})`, icon: WEAPON_ICON(gid) });
    }
  }

  actions.push({ type: 'end-buy', unitId: '__player__' });
  return actions;
}

function actionPhaseActions(state, teamId) {
  const { map: { tiles } } = state.gameSpecific;
  const myUnits  = state.units.filter(u => u.alive && u.ownerId === teamId);
  const actions  = [];
  const bomb     = state.gameSpecific.bomb;
  const losLayers = csLosLayers(state.gameSpecific.map, state.gameSpecific.smokeZones ?? []);

  for (const u of myUnits) {
    if (u.perTurn.moveAllowance > MOVE_EPS) {
      for (const to of getReachable(tiles, u.position, u.perTurn.moveAllowance, state.units))
        actions.push({ type: 'move', unitId: u.id, from: u.position, to });
    }

    // Crouch/stand: a stance toggle, not gated by hasActed (see CROUCH_MOVE_MULT etc.) — a
    // unit can still shoot/reload/throw/plant/defuse the same turn it changes stance.
    // Costs STANCE_COST of the move budget (like rotate/switch-weapon), so only
    // offer it when the unit can still pay — otherwise the toggle is free and can
    // be repeated forever (see STANCE_COST).
    if (u.perTurn.moveAllowance >= STANCE_COST)
      actions.push({ type: u.crouched ? 'stand' : 'crouch', unitId: u.id });

    // Switch active weapon: not gated by hasActed (a unit can swap and still shoot/move the
    // same turn), only by a small moveAllowance tax (SWITCH_WEAPON_COST) — see applyActions.
    // Offered for every owned, non-active slot (a unit always owns pistol+melee; primary only
    // once bought).
    // Gated on affordability as well as taxed: the tax floors at 0
    // (Math.max(0, …)), so an ungated switch is FREE once the budget is spent —
    // and swapping knife↔pistol is a toggle, i.e. another zero-cost cycle back to
    // the identical state. That is the same turn-never-ends trap STANCE_COST
    // describes, and it was the one still open after stance was taxed.
    for (const slot of ['pistol', 'melee', 'primary']) {
      if (slot === u.active || !u.weapons[slot]) continue;
      if (u.perTurn.moveAllowance < SWITCH_WEAPON_COST) continue;
      const w = WEAPONS[u.weapons[slot]];
      actions.push({ type: 'switch-weapon', unitId: u.id, slot, name: `Switch to ${w.name}`, icon: WEAPON_ICON(u.weapons[slot]) });
    }

    // Rotate in place: face any point without moving — not gated by hasActed (like
    // switch-weapon), only a small moveAllowance tax (ROTATE_COST) — see applyActions
    // and isRotateLegal. One untargeted template per unit; the human UI aims freely at
    // any point via the aiming overlay (field.ui.aimedActionTypes) and the AI's search
    // lattice (getSearchActions) expands it into concrete directions.
    if (u.perTurn.moveAllowance >= ROTATE_COST)
      actions.push({ type: 'rotate', unitId: u.id });

    if (!u.perTurn.hasActed) {
      // Shoot (not available while blinded or out of ammo in the magazine — melee has no
      // ammo, so it's always "loaded"). Only the currently drawn weapon can fire. Line of
      // sight is the exact continuous test against walls + smoke (matches getVisibleState).
      const activeWpnId = u.weapons[u.active];
      const wpn = WEAPONS[activeWpnId];
      const loaded = u.active === 'melee' || u.ammo[u.active].mag > 0;
      // No max range — a bullet travels until it hits a wall/smoke or a unit (see
      // applyActions), so LOS is the only gate here; accuracy still falls off with
      // distance and clamps at 0, a soft rather than hard cutoff. No `range` field on
      // the action either (see DoomGame.js/SchematicLayer.vue) — the aim preview
      // shouldn't draw a max-range circle that no longer exists.
      if (!u.blinded && loaded) {
        const enemies = state.units.filter(e => e.alive && e.ownerId !== teamId);
        for (const e of enemies) {
          const d = euclidean(u.position, e.position);
          if (csHasLOS(losLayers, num(u.position.x), num(u.position.y), num(e.position.x), num(e.position.y)))
            // damage/accuracy mirror applyActions' shoot formula (see calcDamage there) —
            // an estimate for the design UI's aiming overlay preview, not itself authoritative.
            actions.push({
              type: 'shoot', unitId: u.id, targetId: e.id,
              damage: wpn.damage, accuracy: Math.max(0, 0.90 - 0.40 * (d / wpn.range)),
            });
        }
      }

      // Reload (usable even while blinded; melee never needs it)
      if (u.active !== 'melee') {
        const ammo = u.ammo[u.active];
        if (ammo.mag < wpn.magSize && ammo.reserve > 0)
          actions.push({ type: 'reload', unitId: u.id });
      }

      // Throw grenades (usable even while blinded): one representative action per
      // grenade type held, not a tile lattice — RandomAgent expands this into exact
      // continuous points itself (see RandomAgent.js's getSearchActions fallback,
      // same lattice the Obscuro search uses), and the human UI aims freely at any
      // exact point within range (see isThrowLegal). icon/name/range/blastRadius let
      // the design UI's aiming overlay describe the throw before a point is chosen.
      for (const [gid, count] of Object.entries(u.grenades ?? {})) {
        if (!count) continue;
        actions.push({
          type: 'throw', unitId: u.id, grenade: gid,
          icon: WEAPON_ICON(gid), name: GRENADES[gid].name,
          range: GRENADE_THROW_RANGE, blastRadius: grenadeBlastRadius(gid),
          ...grenadePreview(gid),
        });
      }

      // Plant bomb (T only, at bombsite)
      if (teamId === 'T' && !bomb?.planted && isBombsite(tiles, u.position.x, u.position.y))
        actions.push({ type: 'plant', unitId: u.id });

      // Defuse bomb (CT only, standing on bomb). Positions can be continuous
      // (free-form movement), so "standing on" is a proximity check, not exact equality.
      if (teamId === 'CT' && bomb?.planted && euclidean(u.position, bomb.plantedAt) < 0.5)
        actions.push({ type: 'defuse', unitId: u.id });
    }
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// ── isMoveLegal (internal, called with team ID) ─────────────────────────────────
// Geometric fallback for the human UI's continuous click-to-move (see the doom
// equivalent in DoomGame.js and engine/ActionValidator.js): actionPhaseActions above
// still enumerates a discrete candidate set for AI search, but a player's move can
// target any point their click resolves to.
function isMoveLegal(state, teamId, action) {
  if (state.currentPhase !== 'action') return false; // no free-form moves during the buy phase
  const map  = state.gameSpecific.map;
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== teamId || unit.perTurn.moveAllowance <= MOVE_EPS) return false;
  // Continuous geometry runs in float64; convert the authoritative BigNumber position
  // and the incoming wire coordinate to Number here (see games/coord.js §2).
  const px = num(unit.position.x), py = num(unit.position.y);
  const x = num(action.to.x), y = num(action.to.y);
  const dist = Math.hypot(px - x, py - y);
  // Reject a move that doesn't actually move (below MOVE_EPS): such a move spends no budget and
  // never ends the unit's turn, so accepting one lets the AI loop on it forever (see MOVE_EPS).
  if (dist < MOVE_EPS) return false;
  if (!isWalkableContinuous(map, x, y)) return false;
  if (dist > unit.perTurn.moveAllowance) return false;
  if (!isPathClearContinuous(map, px, py, x, y)) return false;
  if (!isClearOfUnits(x, y, state.units, unit.id)) return false;
  return true;
}

// Geometric fallback for a human continuous grenade throw (see engine/ActionValidator.js).
// actionPhaseActions enumerates a discrete tile candidate set (getThrowTargets) for AI
// search; a player may throw to any exact point within range on a walkable tile (no LOS
// required, matching getThrowTargets). Consuming the grenade is validated at apply time.
function isThrowLegal(state, teamId, action) {
  if (state.currentPhase !== 'action') return false; // grenades are thrown in the action phase
  const map  = state.gameSpecific.map;
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== teamId || unit.perTurn.hasActed) return false;
  if (!(unit.grenades?.[action.grenade] > 0)) return false;
  const x = num(action.target.x), y = num(action.target.y);
  if (!isWalkableContinuous(map, x, y)) return false;
  if (Math.hypot(num(unit.position.x) - x, num(unit.position.y) - y) > GRENADE_THROW_RANGE) return false;
  return true;
}

// Geometric fallback for a human continuous rotate (turn in place, no move): aim at
// any exact point and the unit faces it — no LOS/wall requirement, matching FFTA's
// untargeted facing choice. actionPhaseActions offers one template per unit with
// enough budget; a player may aim at any point.
function isRotateLegal(state, teamId, action) {
  if (state.currentPhase !== 'action') return false; // no free-form rotate during the buy phase
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== teamId || unit.perTurn.moveAllowance < ROTATE_COST) return false;
  const px = num(unit.position.x), py = num(unit.position.y);
  const x = num(action.target.x), y = num(action.target.y);
  if (Math.hypot(px - x, py - y) < MOVE_EPS) return false; // no direction to face
  return true;
}

// Dispatcher for the engine's continuous-action fallback: 'move'/'throw'/'rotate' carry
// continuous points a player clicked, so they can't be pre-enumerated for exact match.
function isActionLegal(state, teamId, action) {
  if (action.type === 'move')   return isMoveLegal(state, teamId, action);
  if (action.type === 'throw')  return isThrowLegal(state, teamId, action);
  if (action.type === 'rotate') return isRotateLegal(state, teamId, action);
  return false;
}

// Stable identity for the ObscuroAgent's search tree and its map-back of the chosen action
// onto the legal set. The generic defaultActionKey only looks at type/unitId/from/to/targetId,
// which is disastrous here: it ignores `item` (so every buy for a unit collides — the agent
// would "buy" whatever item happens to be first in the legal list) and `grenade`/`target` (so a
// concrete thrown grenade collides with the target-less `throw` template from getLegalActions,
// and the agent hands that template — with no target — to applyActions, which then crashes in
// parsePos on the missing point, hanging the turn). Capture every field that distinguishes one
// legal action from another; coordinates go through num() so continuous points key consistently.
function csActionKey(a) {
  const pt = p => (p && typeof p === 'object') ? [num(p.x), num(p.y)] : null;
  return JSON.stringify([
    a.type ?? null, a.unitId ?? null,
    a.item ?? null, a.grenade ?? null, a.slot ?? null,
    a.targetId ?? null, pt(a.to), pt(a.target),
  ]);
}

// Continuous action set for the ObscuroAgent's tree search: each mover's discrete tile
// moves AND each thrower's discrete grenade targets are replaced by a lattice of exact
// continuous points (see games/continuousMove.js), so the AI positions and aims freely
// like a human. Other actions (shoot/reload/plant/defuse/skip/end-turn) pass through.
function getSearchActions(state, teamId, res) {
  const units = state.units;
  const originOf = a => { const u = units.find(x => x.id === a.unitId); return u ? { x: num(u.position.x), y: num(u.position.y) } : null; };
  // getLegalActions is phase-aware (buy phase has no moves/throws → base passes through).
  let out = latticeActions(getLegalActions(state, teamId), {
    type: 'move', point: 'to',
    origin: a => {
      const o = originOf(a);
      const u = units.find(x => x.id === a.unitId);
      return o && u && { ...o, range: u.perTurn.moveAllowance };
    },
    isLegal: (a, x, y) => isMoveLegal(state, teamId, { unitId: a.unitId, to: { x, y } }),
  }, res);
  out = latticeActions(out, {
    type: 'throw', point: 'target',
    origin: a => { const o = originOf(a); return o && { ...o, range: GRENADE_THROW_RANGE }; },
    isLegal: (a, x, y) => isThrowLegal(state, teamId, { unitId: a.unitId, grenade: a.grenade, target: { x, y } }),
  }, res);
  // Rotate has no meaningful "range" (only the bearing matters) — a small fixed radius
  // just gives the lattice generator a nonzero ring to place candidate directions on.
  out = latticeActions(out, {
    type: 'rotate', point: 'target',
    origin: a => { const o = originOf(a); return o && { ...o, range: 1 }; },
    isLegal: (a, x, y) => isRotateLegal(state, teamId, { unitId: a.unitId, target: { x, y } }),
  }, res);
  return out;
}

// ── Round result check ────────────────────────────────────────────────────────

function getRoundResult(state) {
  const gs      = state.gameSpecific;
  const tAlive  = state.units.some(u => u.ownerId === 'T'  && u.alive);
  const ctAlive = state.units.some(u => u.ownerId === 'CT' && u.alive);

  if (!tAlive)  return 'CT';
  if (!ctAlive) return 'T';

  if (gs.bomb?.planted && gs.bomb.timer <= 0) return 'T';
  if (gs.bomb?.defuseProgress >= (gs.bomb.defuseNeeded ?? DEFUSE_NEEDED)) return 'CT';

  if (!gs.bomb?.planted && gs.roundEndTurns >= ROUND_TURN_MAX) return 'CT';

  return null;
}

// ── Start next round ──────────────────────────────────────────────────────────

function startNewRound(state, roundWinner) {
  const gs = state.gameSpecific;

  const tScore  = gs.tScore  + (roundWinner === 'T'  ? 1 : 0);
  const ctScore = gs.ctScore + (roundWinner === 'CT' ? 1 : 0);

  const losses = {
    T:  roundWinner === 'T'  ? 0 : gs.consecutiveLosses.T  + 1,
    CT: roundWinner === 'CT' ? 0 : gs.consecutiveLosses.CT + 1,
  };

  // Money is per-unit and persists across rounds (dead players keep their cash). Carry
  // each unit's wallet onto its freshly-respawned self, then add that team's round-end
  // reward — the win bonus, or a loss bonus that grows with consecutive losses.
  const roundReward = (team) =>
    roundWinner === team ? WIN_REWARD : lossReward(gs.consecutiveLosses[team]);
  const prevMoney = new Map(state.units.map(u => [u.id, u.money]));
  const units = spawnUnits(gs.map).map(u => ({
    ...u,
    money: Math.min(MAX_MONEY, (prevMoney.get(u.id) ?? STARTING_MONEY) + roundReward(u.ownerId)),
  }));

  return {
    ...state,
    turnNumber: state.turnNumber + 1,
    activePlayers: [gs.teamPlayerMap['T']],
    currentPhase: 'buy',
    units,
    lastActions: state.lastActions,
    gameSpecific: {
      ...gs,
      roundNumber: gs.roundNumber + 1,
      tScore, ctScore,
      consecutiveLosses: losses,
      buyPhase: 'T',
      bomb: { planted: false, plantedAt: null, timer: BOMB_TIMER,
              defuseProgress: 0, defusingUnitId: null, defuseNeeded: DEFUSE_NEEDED },
      smokeZones: [],
      fireZones: [],
      roundEndTurns: 0,
      roundResult: null,
      map: gs.map,
    },
  };
}

// ── applyActions ──────────────────────────────────────────────────────────────

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  let { units } = state;
  let gs = { ...state.gameSpecific };

  // ── BUY PHASE ────────────────────────────────────────────────────────────────
  if (state.currentPhase === 'buy') {
    if (action.type === 'buy') {
      const { item, unitId } = action;
      // A buy grants the item to `unitId` AND debits that same unit's wallet — money is
      // per-player, so one CT's purchase never drains the rest of the team's cash. It also
      // bumps buysThisRound, the counter buyActions uses to cap purchases per unit (the cap
      // keeps the buy phase short — an AI won't value leftover money, so without it it would
      // buy until broke). The counter resets each round because units respawn fresh.
      const apply = (cost, grant) => {
        units = units.map(u => u.id === unitId
          ? { ...grant(u), money: u.money - cost, buysThisRound: (u.buysThisRound ?? 0) + 1 }
          : u);
      };

      if (item === 'armor') {
        apply(ARMOR_COST, u => ({ ...u, armor: ARMOR_HP }));
      } else if (item === 'helmet') {
        apply(EQUIPMENT.helmet.cost, u => ({ ...u, helmet: true }));
      } else if (item === 'defusekit') {
        apply(EQUIPMENT.defusekit.cost, u => ({ ...u, hasKit: true }));
      } else if (GRENADES[item]) {
        apply(GRENADES[item].cost, u => ({ ...u, grenades: { ...u.grenades, [item]: (u.grenades[item] ?? 0) + 1 } }));
      } else if (WEAPONS[item]) {
        // Fills the item's slot (pistol upgrade or primary) and auto-equips it — you just
        // spent money on it, so it's what you're holding. Doesn't touch the other slot.
        const slot = WEAPON_SLOT(WEAPONS[item].category);
        apply(WEAPONS[item].cost, u => ({
          ...u, weapons: { ...u.weapons, [slot]: item }, active: slot, type: WEAPONS[item].category,
          ammo: { ...u.ammo, [slot]: fullAmmo(item) },
        }));
      }

      return { ...state, units, gameSpecific: gs, lastActions: playerActions };
    }

    if (action.type === 'end-buy') {
      if (gs.buyPhase === 'T') {
        return { ...state, units, activePlayers: [gs.teamPlayerMap['CT']], currentPhase: 'buy',
                 gameSpecific: { ...gs, buyPhase: 'CT' }, lastActions: playerActions };
      }
      return { ...state, units, activePlayers: [gs.teamPlayerMap['T']], currentPhase: 'action',
               gameSpecific: { ...gs, buyPhase: 'done' }, lastActions: playerActions };
    }
  }

  // ── ACTION PHASE ──────────────────────────────────────────────────────────────
  if (state.currentPhase === 'action') {
    const { tiles } = gs.map;
    let bomb       = { ...gs.bomb };
    let smokeZones = [...(gs.smokeZones ?? [])];
    let fireZones  = [...(gs.fireZones  ?? [])];

    if (action.type === 'move') {
      // Moving CT away from bomb resets defuse progress
      if (playerId === 'CT' && bomb.planted && bomb.defusingUnitId === action.unitId)
        bomb = { ...bomb, defuseProgress: 0, defusingUnitId: null };

      // action.to: decimal strings (human continuous click) or integer tile (AI); store
      // as the authoritative BigNumber position (see games/coord.js).
      const to = parsePos(action.to);
      units = units.map(u => {
        if (u.id !== action.unitId) return u;
        // Movement-derived heading drives the unit's vision cone (games/vision.js); a
        // zero-length move keeps the prior facing.
        const dx = num(to.x) - num(u.position.x), dy = num(to.y) - num(u.position.y);
        const dist = Math.hypot(dx, dy);
        const facing = (dx || dy) ? Math.atan2(dy, dx) : u.facing;
        return { ...u, position: to, facing,
                 perTurn: { ...u.perTurn, moveAllowance: Math.max(0, u.perTurn.moveAllowance - dist) } };
      });
      const s0 = { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      const rr = getRoundResult(s0);
      if (rr) return startNewRound(s0, rr);
      return s0;
    }

    if (action.type === 'shoot') {
      const attacker = units.find(u => u.id === action.unitId);
      const defender = units.find(u => u.id === action.targetId);
      const wpn      = WEAPONS[attacker.weapons[attacker.active]];
      const d        = euclidean(attacker.position, defender.position);
      const accuracy = Math.max(0, 0.90 - 0.40 * (d / wpn.range));

      units = units.map(u => u.id === action.unitId
        ? { ...u,
            ammo: u.active === 'melee' ? u.ammo : { ...u.ammo, [u.active]: { ...u.ammo[u.active], mag: u.ammo[u.active].mag - 1 } },
            perTurn: { ...u.perTurn, hasActed: true } } : u);

      if (rng() > accuracy) {
        return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      }

      const dmg    = calcDamage(wpn.damage, defender);
      const newHp  = Math.max(0, defender.hp - dmg);
      const killed = newHp === 0;

      units = units.map(u => u.id === action.targetId
        ? { ...u, hp: newHp, alive: !killed, armor: killed ? 0 : u.armor } : u);

      if (killed) {
        units = units.map(u => u.id === action.unitId
          ? { ...u, money: Math.min(MAX_MONEY, u.money + KILL_REWARD) } : u);
        if (bomb.defusingUnitId === action.targetId)
          bomb = { ...bomb, defuseProgress: 0, defusingUnitId: null };
      }

      const s1 = { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      const rr1 = getRoundResult(s1);
      if (rr1) return startNewRound(s1, rr1);
      return s1;
    }

    if (action.type === 'throw') {
      const { grenade } = action;
      // getLegalActions emits a target-LESS `throw` template (one per grenade held) that the AI
      // search and the human UI both expand into a concrete aim point; it is never itself a
      // playable action. Guard against one slipping through (e.g. an agent's last-ditch fallback
      // to legalActions[0]): consume the unit's action so play advances rather than crashing in
      // parsePos on the missing point or looping forever re-picking the same template.
      if (!action.target) {
        units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, hasActed: true } } : u);
        return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      }
      // target: decimal strings (human continuous click) or integer tile (AI candidate).
      const target = parsePos(action.target);
      const losLayers = csLosLayers(gs.map, smokeZones);

      // Consume grenade and mark hasActed
      units = units.map(u => u.id === action.unitId
        ? { ...u,
            grenades: { ...u.grenades, [grenade]: (u.grenades[grenade] ?? 1) - 1 },
            perTurn:  { ...u.perTurn, hasActed: true } }
        : u);

      if (grenade === 'he') {
        const enemiesBefore = new Set(units.filter(u => u.alive && u.ownerId !== playerId).map(u => u.id));
        units = units.map(u => {
          if (!u.alive || euclidean(u.position, target) > HE_RADIUS) return u;
          const newHp = Math.max(0, u.hp - calcDamage(HE_DAMAGE, u));
          return { ...u, hp: newHp, alive: newHp > 0, armor: newHp > 0 ? u.armor : 0 };
        });
        const kills = units.filter(u => !u.alive && enemiesBefore.has(u.id)).length;
        if (kills > 0)
          units = units.map(u => u.id === action.unitId
            ? { ...u, money: Math.min(MAX_MONEY, u.money + kills * KILL_REWARD) } : u);
        if (bomb.defusingUnitId && !units.find(u => u.id === bomb.defusingUnitId)?.alive)
          bomb = { ...bomb, defuseProgress: 0, defusingUnitId: null };

      } else if (grenade === 'flash') {
        units = units.map(u => {
          if (!u.alive || u.ownerId === playerId) return u;
          if (euclidean(u.position, target) <= FLASH_RADIUS &&
              csHasLOS(losLayers, num(u.position.x), num(u.position.y), num(target.x), num(target.y)))
            return { ...u, blinded: FLASH_BLIND_TURNS };
          return u;
        });

      } else if (grenade === 'smoke') {
        smokeZones = [...smokeZones, { x: num(target.x), y: num(target.y), turnsLeft: SMOKE_TURNS }];

      } else if (grenade === 'molotov' || grenade === 'incendiary') {
        fireZones = [...fireZones, { x: num(target.x), y: num(target.y), turnsLeft: FIRE_TURNS }];
      }
      // decoy: no mechanical effect

      const s2 = { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      const rr2 = getRoundResult(s2);
      if (rr2) return startNewRound(s2, rr2);
      return s2;
    }

    if (action.type === 'crouch' || action.type === 'stand') {
      const crouched = action.type === 'crouch';
      units = units.map(u => u.id === action.unitId
        ? { ...u, crouched,
            visionRange: crouched ? CS_VISION.range * CROUCH_VISION_MULT : undefined,
            perTurn: { ...u.perTurn, moveAllowance: Math.max(0, u.perTurn.moveAllowance - STANCE_COST) } }
        : u);
      return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
    }

    if (action.type === 'plant') {
      const u = units.find(u => u.id === action.unitId);
      bomb = { planted: true, plantedAt: { ...u.position }, timer: BOMB_TIMER,
               defuseProgress: 0, defusingUnitId: null, defuseNeeded: DEFUSE_NEEDED };
      units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { hasActed: true, moveAllowance: 0 } } : u);
      return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
    }

    if (action.type === 'defuse') {
      const u = units.find(u => u.id === action.unitId);
      let { defuseProgress, defusingUnitId, defuseNeeded = DEFUSE_NEEDED } = bomb;
      if (defusingUnitId !== action.unitId) {
        // New unit started defusing — kit status determines speed
        defuseProgress = 0;
        defuseNeeded   = u.hasKit ? 1 : DEFUSE_NEEDED;
      }
      defuseProgress += 1;
      bomb = { ...bomb, defuseProgress, defusingUnitId: action.unitId, defuseNeeded };
      units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, hasActed: true } } : u);

      const s3 = { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      const rr3 = getRoundResult(s3);
      if (rr3) return startNewRound(s3, rr3);
      return s3;
    }

    if (action.type === 'reload') {
      units = units.map(u => {
        if (u.id !== action.unitId) return u;
        const wpn    = WEAPONS[u.weapons[u.active]];
        const ammo   = u.ammo[u.active];
        const needed = wpn.magSize - ammo.mag;
        const drawn  = Math.min(needed, ammo.reserve);
        return { ...u,
          ammo: { ...u.ammo, [u.active]: { mag: ammo.mag + drawn, reserve: ammo.reserve - drawn } },
          perTurn: { ...u.perTurn, hasActed: true } };
      });
      return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
    }

    if (action.type === 'switch-weapon') {
      units = units.map(u => u.id === action.unitId
        ? { ...u, active: action.slot, type: WEAPONS[u.weapons[action.slot]].category,
            perTurn: { ...u.perTurn, moveAllowance: Math.max(0, u.perTurn.moveAllowance - SWITCH_WEAPON_COST) } }
        : u);
      return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
    }

    if (action.type === 'rotate') {
      const target = parsePos(action.target);
      units = units.map(u => {
        if (u.id !== action.unitId) return u;
        const dx = num(target.x) - num(u.position.x), dy = num(target.y) - num(u.position.y);
        return { ...u, facing: Math.atan2(dy, dx),
                 perTurn: { ...u.perTurn, moveAllowance: Math.max(0, u.perTurn.moveAllowance - ROTATE_COST) } };
      });
      return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
    }

    if (action.type === 'end-turn') {
      const otherTeam     = playerId === 'T' ? 'CT' : 'T';
      const roundEndTurns = gs.roundEndTurns + 1;

      // Tick bomb timer when T ends turn after plant
      let newBomb = { ...bomb };
      if (playerId === 'T' && bomb.planted) newBomb = { ...bomb, timer: bomb.timer - 1 };

      // Tick smoke zones
      const newSmokeZones = smokeZones
        .map(sz => ({ ...sz, turnsLeft: sz.turnsLeft - 1 }))
        .filter(sz => sz.turnsLeft > 0);

      // Apply fire damage then tick fire zones
      let newFireZones = fireZones;
      if (fireZones.length > 0) {
        const fireSet = buildFireSet(fireZones);
        units = units.map(u => {
          if (!u.alive || !fireSet.has(`${tileNum(u.position.x)},${tileNum(u.position.y)}`)) return u;
          const newHp = Math.max(0, u.hp - calcDamage(FIRE_DAMAGE, u));
          return { ...u, hp: newHp, alive: newHp > 0, armor: newHp > 0 ? u.armor : 0 };
        });
        if (newBomb.defusingUnitId && !units.find(u => u.id === newBomb.defusingUnitId)?.alive)
          newBomb = { ...newBomb, defuseProgress: 0, defusingUnitId: null };
        newFireZones = fireZones
          .map(fz => ({ ...fz, turnsLeft: fz.turnsLeft - 1 }))
          .filter(fz => fz.turnsLeft > 0);
      }

      // Reset perTurn for current team; reduce blind timers (blind expires at end of their own turn).
      // Move budget scales with the currently-drawn weapon (SLOT_MOVE_MULT) and stance.
      units = units.map(u => {
        if (u.ownerId !== playerId) return u;
        return { ...u, blinded: Math.max(0, u.blinded - 1),
                 perTurn: { hasActed: false,
                            moveAllowance: MOVE_RANGE * SLOT_MOVE_MULT[u.active] * (u.crouched ? CROUCH_MOVE_MULT : 1) } };
      });

      const tentative = {
        ...state, units,
        activePlayers: [gs.teamPlayerMap[otherTeam]],
        turnNumber: playerId === 'CT' ? state.turnNumber + 1 : state.turnNumber,
        gameSpecific: { ...gs, bomb: newBomb, smokeZones: newSmokeZones, fireZones: newFireZones, roundEndTurns },
        lastActions: playerActions,
      };

      const rr = getRoundResult(tentative);
      if (rr) return startNewRound(tentative, rr);
      return tentative;
    }
  }

  return state;
}

// ── getLegalActions ───────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  if (state.currentPhase === 'buy') return buyActions(state, playerId);
  return actionPhaseActions(state, playerId);
}

// ── getResult ─────────────────────────────────────────────────────────────────

function getResult(state) {
  const { tScore, ctScore, winRounds, maxRounds, roundNumber, teamPlayerMap } = state.gameSpecific;
  if (tScore  >= winRounds) return { outcome: 'win', winnerId: teamPlayerMap['T'],  reason: `T ${tScore}-${ctScore} CT` };
  if (ctScore >= winRounds) return { outcome: 'win', winnerId: teamPlayerMap['CT'], reason: `CT ${ctScore}-${tScore} T` };
  if (roundNumber > maxRounds) {
    if (tScore > ctScore) return { outcome: 'win', winnerId: teamPlayerMap['T'],  reason: `T ${tScore}-${ctScore} CT` };
    if (ctScore > tScore) return { outcome: 'win', winnerId: teamPlayerMap['CT'], reason: `CT ${ctScore}-${tScore} T` };
    return { outcome: 'draw', winnerId: null, reason: `tied ${tScore}-${ctScore}` };
  }
  return null;
}

// ── renderState ───────────────────────────────────────────────────────────────

function renderState(state) {
  const gs         = state.gameSpecific;
  const activeTeam = gs.teamMap?.[state.activePlayers[0]] ?? state.activePlayers[0];
  const phase      = state.currentPhase === 'buy'
    ? `BUY (${gs.buyPhase} buying)`
    : `ACTION (${activeTeam} to move)`;

  const teamSummary = (tid) => {
    const teamUnits = state.units.filter(u => u.ownerId === tid);
    const cash  = teamUnits.reduce((a, u) => a + (u.money ?? 0), 0);
    const uStr  = teamUnits.filter(u => u.alive).map(u => {
      const activeWpn = u.weapons[u.active];
      const ammoStr = u.active === 'melee' ? '' : `(${u.ammo[u.active].mag}/${u.ammo[u.active].reserve})`;
      let s = `${u.id}:${activeWpn}${ammoStr}`;
      if (u.armor)  s += '+vest';
      if (u.helmet) s += '+helm';
      if (u.hasKit) s += '+kit';
      const gStr = Object.entries(u.grenades ?? {}).filter(([, c]) => c > 0).map(([g, c]) => `${g}×${c}`).join(',');
      if (gStr) s += `[${gStr}]`;
      if (u.blinded) s += '(blind)';
      if (u.crouched) s += '(crouched)';
      return `${s}(${u.hp}hp,$${u.money})`;
    }).join(' ');
    return `  ${tid} $${cash} | ${uStr || '(all dead)'}`;
  };

  const defuseNeeded = gs.bomb?.defuseNeeded ?? DEFUSE_NEEDED;
  const bombLine = !gs.bomb?.planted
    ? '  Bomb: not planted'
    : `  Bomb: PLANTED at (${gs.bomb.plantedAt.x},${gs.bomb.plantedAt.y}) — ${gs.bomb.timer} turns left` +
      (gs.bomb.defuseProgress ? ` [defuse ${gs.bomb.defuseProgress}/${defuseNeeded}]` : '');

  const effectLines = [];
  if ((gs.smokeZones ?? []).length > 0)
    effectLines.push(`  Smoke: ${gs.smokeZones.map(s => `(${s.x},${s.y})×${s.turnsLeft}t`).join(' ')}`);
  if ((gs.fireZones ?? []).length > 0)
    effectLines.push(`  Fire:  ${gs.fireZones.map(f => `(${f.x},${f.y})×${f.turnsLeft}t`).join(' ')}`);

  return [
    `═══ Round ${gs.roundNumber}  T ${gs.tScore} — ${gs.ctScore} CT  |  ${phase} ═══`,
    renderMap(state),
    `Legend: T=Terrorist C=Counter-Terrorist A=Bombsite-A B=Bombsite-B c=CT-spawn t=T-spawn !=bomb @=smoke *=fire`,
    '',
    teamSummary('T'),
    teamSummary('CT'),
    bombLine,
    ...effectLines,
  ].join('\n');
}

// ── toGrid (design UI) ──────────────────────────────────────────────────────────

const TERRAIN_INFO = {
  wall:      { name: 'Wall',       description: 'Impassable, blocks line of sight.' },
  floor:     { name: 'Floor',      description: 'Open ground.' },
  bombsiteA: { name: 'Bombsite A', description: 'Bomb can be planted or defused here.' },
  bombsiteB: { name: 'Bombsite B', description: 'Bomb can be planted or defused here.' },
  ctSpawn:   { name: 'CT Spawn',   description: 'Counter-Terrorist starting area.' },
  tSpawn:    { name: 'T Spawn',    description: 'Terrorist starting area.' },
  // Elevation workaround (no z-axis in this engine): blocks movement like a wall, but is
  // excluded from LOS blocking (see csLosLayers in belief.js) so it can be seen/shot
  // across or over, standing in for real waist-high/elevated cover.
  lowWall:   { name: 'Low wall / ledge', description: 'Blocks movement, but not sight — an elevation stand-in.' },
};

const SHAPE_FLOOR = '#c8c0a8';

// Dynamic effects (smoke/fire/bomb) as render shapes, so they layer above the terrain
// rather than recolouring the flat tile backdrop.
function effectShapes(gs) {
  const out = [];
  // Drawn from the SAME geometry that blocks sight (weapons.js's smokeOval, which
  // belief.js's csLosLayers also uses) so the cloud you see is exactly the cloud
  // that hides you. These were written out separately and had drifted: the drawn
  // one was radius r+0.5 centred half a unit down-right of the real one.
  for (const sz of gs.smokeZones ?? [])
    out.push({ ...smokeOval(num(sz.x), num(sz.y)), fill: '#9098a0', opacity: 0.6 });
  for (const fz of gs.fireZones ?? [])
    out.push({ shape: 'oval', x: fz.x - FIRE_RADIUS, y: fz.y - FIRE_RADIUS,
               w: FIRE_RADIUS * 2 + 1, h: FIRE_RADIUS * 2 + 1, fill: '#c85a2a', opacity: 0.6 });
  if (gs.bomb?.planted)
    out.push({ shape: 'oval', x: num(gs.bomb.plantedAt.x) - 0.1, y: num(gs.bomb.plantedAt.y) - 0.1,
               w: 1.2, h: 1.2, fill: '#e04040' });
  return out;
}

// One row per owned loadout slot, the active one flagged "(equipped)" — see the
// 'switch-weapon' action for how a unit changes which is drawn.
function slotRow(label, u, slot) {
  const wid = u.weapons[slot];
  if (!wid) return { label, value: 'None' };
  const name = WEAPONS[wid].name + (u.active === slot ? ' (equipped)' : '');
  return { label, value: name, icon: WEAPON_ICON(wid) };
}

function equipmentList(u) {
  const activeGrenades = Object.entries(u.grenades ?? {}).filter(([, c]) => c > 0);
  const grenadeStr = activeGrenades
    .map(([g, c]) => `${GRENADES[g]?.name ?? g}${c > 1 ? ` ×${c}` : ''}`)
    .join(', ');
  const activeAmmo = u.active === 'melee' ? null : u.ammo[u.active];
  return [
    slotRow('Pistol',  u, 'pistol'),
    slotRow('Primary', u, 'primary'),
    slotRow('Melee',   u, 'melee'),
    { label: 'Ammo',    value: activeAmmo ? `${activeAmmo.mag} / ${activeAmmo.reserve}` : '—' },
    { label: 'Armor',   value: u.armor ? (u.helmet ? 'Vest + Helmet' : 'Vest') : 'None',
      icon: u.armor ? WEAPON_ICON(u.helmet ? 'helmet' : 'armor') : undefined },
    { label: 'Grenades', value: grenadeStr || 'None',
      icon: activeGrenades.length === 1 ? WEAPON_ICON(activeGrenades[0][0]) : undefined },
    ...(u.ownerId === 'CT' ? [{ label: 'Defuse Kit', value: u.hasKit ? 'Yes' : 'No',
      icon: u.hasKit ? WEAPON_ICON('defusekit') : undefined }] : []),
  ];
}

function toGrid(state) {
  const { units, gameSpecific: gs } = state;
  const { tiles, width, height }    = gs.map;
  const playerIdx = {};
  (state.players ?? []).forEach((p, i) => { playerIdx[p.id] = i + 1; });

  // Terrain-only cells (uniform floor; walls/sites drawn as the SVG shapes below).
  // Unit positions travel in the continuous `units` channel, not by exact-match into
  // this integer grid — every CS map renders as layered SVG shapes and effects
  // (smoke/fire/bomb) draw on top.
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[`${x},${y}`] ?? 'floor';
      cells.push({
        x, y,
        color:   SHAPE_FLOOR,
        terrain: TERRAIN_INFO[t] ?? TERRAIN_INFO.floor,
      });
    }
  }

  // Continuous unit channel: real (possibly non-integer) positions as decimal strings
  // (see games/coord.js), built directly from state.units.
  const unitList = units.filter(u => u.alive).map(u => {
    const p = posToWire(u.position);
    return {
      id: u.id, x: p.x, y: p.y,
      glyph:         'P',
      unitName:      FACTION_NAMES[u.faction] ?? u.id,
      facing:        u.facing,
      money:         u.money,
      // Weapon category (pistol/smg/shotgun/heavy/rifle/sniper), not just the constant
      // 'player' — feeds the generic per-type marker-shape hash (see data.js's
      // markerShapeFor) so a squad's loadouts stay visually distinguishable on the map.
      type:          u.type,
      owner:         playerIdx[gs.teamPlayerMap[u.ownerId]] ?? 0,
      hp:            u.hp,
      maxHp:         u.maxHp,
      job:           u.weapons[u.active],
      portraitPath:  `/images/cs/units/${u.faction}`,
      spriteLayers:  spriteLayers(u),
      hitRFrac:      u.armor ? ARMOR_HIT_RFRAC : 1,
      moveRange:     u.perTurn?.moveAllowance,
      equipment:     equipmentList(u),
      statusEffects: [...(u.blinded ? ['blinded'] : []), ...(u.crouched ? ['crouched'] : [])],
      moved:         u.perTurn?.moveAllowance < MOVE_RANGE * SLOT_MOVE_MULT[u.active] * (u.crouched ? CROUCH_MOVE_MULT : 1),
      acted:         u.perTurn?.hasActed,
      // Fraction of incoming damage this unit shrugs off — lets the design UI's aiming
      // overlay show a generic "expected damage" preview (rawDamage * (1 - reduction))
      // for shoot/throw without knowing CS's armor/helmet model itself.
      damageReduction: u.armor ? ARMOR_REDUCTION + (u.helmet ? HELMET_EXTRA_REDUCTION : 0) : 0,
    };
  });

  // Occluder geometry for the client's fog/reach renderer — the SAME ordered layer stack
  // the engine's getVisibleState blocks sight on (csLosLayers: authored terrain bottom→top
  // with a precomputed `solid` flag, then the border, then smoke), so the drawn veil hides
  // exactly what the engine hides — including terrain carved transparent by a later `floor`
  // shape. Hand-laid grid maps (none currently) fall back to rasterized wall tiles.
  let los;
  if (gs.map.terrainShapes) {
    los = { layerShapes: csLosLayers(gs.map, gs.smokeZones ?? []) };
  } else {
    const blocked = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (tiles[`${x},${y}`] === 'wall') blocked.push(`${x},${y}`);
    los = { blocked };
  }

  return {
    width, height, locationType: 'continuous', cells, units: unitList,
    shapes: [...(gs.map.shapes ?? []), ...effectShapes(gs)],
    // Hand the veil the SAME sight range + cone the engine reveals with (CS_VISION), so the
    // drawn vision matches getVisibleState exactly (both Euclidean now).
    // Move/shoot/throw pick a button first, then a location/direction on the map itself
    // (see the design UI's aiming overlay) instead of listing one button per legal
    // move point/target/tile — these carry continuous aim points or resolve to a
    // target by click direction, so they don't fit a flat action list.
    ui: { hideGridLines: true, visionRange: CS_VISION.range, fovDegrees: CS_VISION.fovDegrees,
          aimedActionTypes: ['move', 'throw', 'shoot', 'rotate'] },
    los,
  };
}

// ── createInitialState ────────────────────────────────────────────────────────

export function createInitialState(players, config = {}) {
  const winRounds = config.winRounds ?? 8;
  const maxRounds = config.maxRounds ?? 15;
  const map       = MAPS[config.mapId ?? config.scenario ?? 'de_dust2'] ?? MAPS.de_dust2;

  const [p1, p2] = players;
  // Slot 0 is always colored teamA (blue) and slot 1 teamB (red) by the generic
  // design-UI slot coloring, so map slot 0 → CT and slot 1 → T to match the
  // conventional CS colors (CT blue, T red).
  const teamMap       = { [p1.id]: 'CT', [p2.id]: 'T' };
  const teamPlayerMap = { CT: p1.id, T: p2.id };

  return {
    gameName: 'CS',
    turnNumber: 1,
    activePlayers: [teamPlayerMap.T],
    currentPhase: 'buy',
    players,
    board: { width: map.width, height: map.height },
    units: spawnUnits(map),
    lastActions: null,
    gameSpecific: {
      roundNumber: 1,
      tScore: 0, ctScore: 0,
      winRounds, maxRounds,
      buyPhase: 'T',
      consecutiveLosses: { T: 0, CT: 0 },
      bomb: { planted: false, plantedAt: null, timer: BOMB_TIMER,
              defuseProgress: 0, defusingUnitId: null, defuseNeeded: DEFUSE_NEEDED },
      smokeZones: [],
      fireZones: [],
      roundEndTurns: 0,
      roundResult: null,
      fogOfWar: config.fogOfWar ?? false,
      map,
      teamMap, teamPlayerMap,
    },
  };
}

// ── Adapter: translate player IDs → team IDs ─────────────────────────────────

function withTeam(fn) {
  return (state, playerIdOrActions, ...rest) => {
    const { teamMap } = state.gameSpecific;
    if (Array.isArray(playerIdOrActions)) {
      const translated = playerIdOrActions.map(pa => ({ ...pa, playerId: teamMap[pa.playerId] ?? pa.playerId }));
      return fn(state, translated, ...rest);
    }
    return fn(state, teamMap[playerIdOrActions] ?? playerIdOrActions, ...rest);
  };
}

function getVisibleState(state, teamId) {
  // Own units + any enemy within an own unit's range and facing cone AND line of sight
  // (walls + smoke). csVisionCfg is shared with belief.js so observation and fog sampler
  // agree — see games/vision.js.
  const cfg = csVisionCfg(state.gameSpecific.map, state.gameSpecific.smokeZones ?? []);
  return {
    ...state,
    units: filterVisibleUnits(state.units, teamId, cfg, p => [num(p.x), num(p.y)]),
  };
}

const PLAYER_SPEED = MOVE_RANGE;
const BULLET_SPEED = 20;

function getActionDuration(state, action) {
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const from = action.from ?? unit.position;
    const dx = num(action.to.x) - num(from.x), dy = num(action.to.y) - num(from.y);
    return Math.sqrt(dx * dx + dy * dy) / PLAYER_SPEED;
  }
  if (action.type === 'shoot') {
    const shooter = state.units.find(u => u.id === action.unitId);
    const target  = state.units.find(u => u.id === action.targetId);
    if (!shooter || !target) return 1;
    const dx = num(target.position.x) - num(shooter.position.x);
    const dy = num(target.position.y) - num(shooter.position.y);
    return Math.sqrt(dx * dx + dy * dy) / BULLET_SPEED;
  }
  if (action.type === 'throw')  return 1.5;
  if (action.type === 'plant')  return 2;
  if (action.type === 'defuse') return 5;
  if (action.type === 'reload') return 2.5;
  return 1;
}

// ── Fog-of-war belief sampler ───────────────────────────────────────────────
// Under fog getVisibleState hands the agent only its own team plus enemies
// within sight. csSampleWorlds reconstructs plausible full worlds ("particles")
// for the generic ObscuroAgent from the stateful CsBelief tracker (belief.js),
// which remembers sightings across turns and localises each unseen enemy near
// where it was last seen. Returns [] when fog is off (agent uses the
// observation as the single known world).
function csSampleWorlds(observation, myTeam, n, rng = Math.random) {
  if (!observation.gameSpecific.fogOfWar) return [];
  const belief = getCsBelief(observation, myTeam);
  belief.beginTurn(observation);
  return belief.sample(observation, n, rng, makeUnit);
}

export const CsGame = {
  // Heuristic leaf value: the full CS position score — round outcome, bomb
  // objective, material and angles (see games/cs/eval.js). This replaces the
  // generic unitStrengthEval (hp + a survival bonus), which was blind to
  // everything that actually decides a CS round: the bomb, the clock, and who
  // holds a shot on whom.
  // Team game: withTeam translates the player id to its team ownerId (T/CT)
  // before the eval — so `teamId` here is 'T' or 'CT', which is what eval.js wants.
  evaluateState: withTeam(csEvaluate),
  // The CS-specialised Obscuro agent (bounded terminals + the CS node heuristic,
  // including the asymmetric cost of walking into a duel you lose). Overrides the
  // builtin generic 'obscuro' entry by id — see api-server.js's dedupeAgents.
  agents: [
    { id: 'obscuro', name: 'AI (Obscuro/CFR)', agent: CsObscuroAgent, analyze: analyzeCsObscuro },
  ],
  // Fog of war: each team sees only enemies near its players; the Obscuro agent
  // samples the unseen enemies via sampleWorlds below.
  gameOptions: [
    MAP_ZOOM_OPTION,
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each team sees only enemies near its own players', type: 'boolean', default: true },
    // The interactive position-analysis panel (apps/design/battlefield/AnalysisPanel.vue).
    // Battlefield.vue gates it on this config flag alone, defaulting to false when a game
    // does not declare the option — so leaving it out made the panel unreachable. CS has
    // had everything behind it since the Obscuro agent landed (the `analyze` entry above,
    // served by POST /sessions/:id/analyze); only the switch was missing. Declared exactly
    // as chess declares it.
    { id: 'showAnalysisPanel', label: 'Analysis Panel', description: 'Show an AI move-analysis panel with board suggestions, live or during replay', type: 'boolean', default: true },
  ],
  sampleWorlds: withTeam(csSampleWorlds),
  name: 'CS',
  scenarios: [
    { id: 'de_dust2', name: 'Dust II',   description: 'The flagship map, in detail — Long, Catwalk, Mid and B Tunnel all named and connected', config: { mapId: 'de_dust2' } },
    { id: 'dust2',    name: 'Dust II (classic)', description: 'Original simplified defuse map — two sites, mid control', config: { mapId: 'dust2' } },
    { id: 'de_dust',  name: 'de_dust',   description: 'Original Dust — linear corridors, symmetric sites', config: { mapId: 'de_dust' } },
    { id: 'cs_siege', name: 'cs_siege',  description: 'T storms a CT-held compound; bombsites inside', config: { mapId: 'cs_siege' } },
    { id: 'cs_italy', name: 'cs_italy',  description: 'Village map — winding streets, market and wine cellar', config: { mapId: 'cs_italy' } },
    { id: 'de_forge', name: 'de_forge',  description: 'Shape terrain — foundry split by a central oval furnace pit', config: { mapId: 'de_forge' } },
    { id: 'de_pond',  name: 'de_pond',   description: 'Shape terrain — waterfront routed around two oval ponds', config: { mapId: 'de_pond' } },
    { id: 'de_plaza', name: 'de_plaza',  description: 'Shape terrain — open oval plaza with a central fountain', config: { mapId: 'de_plaza' } },
  ],
  createInitialState,
  actionKey:        csActionKey,
  getLegalActions:  withTeam(getLegalActions),
  isActionLegal:    withTeam(isActionLegal),
  getSearchActions: withTeam(getSearchActions),
  applyActions:     withTeam(applyActions),
  getResult,
  renderState,
  toGrid,
  getVisibleState:  withTeam(getVisibleState),
  getActionDuration,
};
