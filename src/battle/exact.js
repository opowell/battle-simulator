// ---------------------------------------------------------------------------
// exact.js — a battle spec's formulas, evaluated exactly.
//
// A ruleset names its combat as an expression over attributes, e.g. Arena's
//
//     max(1, floor(a.attack^2 / (a.attack + d.defense * (1 + cover/100))))
//
// and that expression is worked out in exact rationals (BigInt numerator and
// denominator), never in floats: 1/3 is 1/3, and a damage that should be 3 is not
// 2.9999999. Inputs may be any finite JS number (a double is a dyadic rational,
// so even 0.1 converts without loss); what comes out is a rational, and callers
// that need a whole number floor it themselves (see `whole`).
//
// The language is small on purpose:
//
//   numbers        12, 0.5, 1/3 (as an expression)
//   names          attack, a.attack, d.hp — looked up in the environment given
//   operators      + - * /, ^ (whole exponents only), unary -,
//                  comparisons < <= > >= == != (1 or 0), and/or/not via && || !
//   functions      floor ceil round abs min max clamp(x, lo, hi) if(c, a, b)
//
// Nothing else — no square roots, no logs — because nothing else stays rational.
// ---------------------------------------------------------------------------

const ZERO = { n: 0n, d: 1n };
const ONE = { n: 1n, d: 1n };

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };

function norm(n, d) {
  if (d === 0n) throw new Error('exact: division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return g > 1n ? { n: n / g, d: d / g } : { n, d };
}

/** A finite JS number as an exact rational. */
export function rat(x) {
  if (typeof x === 'object' && x && typeof x.n === 'bigint') return x;
  if (typeof x === 'boolean') return x ? ONE : ZERO;
  const v = Number(x);
  if (!Number.isFinite(v)) throw new Error(`exact: not a finite number: ${x}`);
  if (Number.isInteger(v)) return { n: BigInt(v), d: 1n };
  // A number is the decimal it prints as: a spec's 1.1 is 11/10, not the double
  // nearest it — which is what its author wrote.
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(v));
  const frac = m[3] ?? '', exp = Number(m[4] ?? 0) - frac.length;
  const n = BigInt(m[2] + frac) * (m[1] ? -1n : 1n);
  return exp >= 0 ? { n: n * 10n ** BigInt(exp), d: 1n } : norm(n, 10n ** BigInt(-exp));
}

const add = (a, b) => norm(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => norm(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => norm(a.n * b.n, a.d * b.d);
const div = (a, b) => norm(a.n * b.d, a.d * b.n);
const cmp = (a, b) => { const l = a.n * b.d, r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; };

function floorR(a) {
  const q = a.n / a.d;                          // BigInt division truncates toward 0
  return { n: a.n < 0n && q * a.d !== a.n ? q - 1n : q, d: 1n };
}
const ceilR = (a) => { const f = floorR(a); return cmp(f, a) === 0 ? f : add(f, ONE); };

function powR(a, e) {
  if (e.d !== 1n) throw new Error('exact: ^ takes a whole exponent');
  let k = e.n < 0n ? -e.n : e.n, out = ONE, base = a;
  while (k > 0n) { if (k & 1n) out = mul(out, base); base = mul(base, base); k >>= 1n; }
  return e.n < 0n ? div(ONE, out) : out;
}

/** The rational as a JS number (exact for integers in the safe range). */
export const toNumber = (a) => (a.d === 1n ? Number(a.n) : Number(a.n) / Number(a.d));

/** The rational floored to a whole JS number. */
export const whole = (a) => Number(floorR(a).n);

// ── Parsing ──────────────────────────────────────────────────────────────────

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][\w.]*)|(<=|>=|==|!=|&&|\|\||[-+*/^(),<>!]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`exact: cannot read "${src.slice(i)}" in "${src}"`);
    out.push(m[1] != null ? { num: m[1] } : m[2] != null ? { name: m[2] } : { op: m[3] });
    i = re.lastIndex;
  }
  return out;
}

// Precedence climbing: || && , comparisons, + -, * /, unary, ^ (right-assoc).
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (op) => toks[p]?.op === op;
  const expect = (op) => { if (!isOp(op)) throw new Error(`exact: expected "${op}" in "${src}"`); p++; };
  const binary = (next, ops) => () => {
    let left = next();
    while (ops.includes(peek()?.op)) { const op = toks[p++].op; left = { op, args: [left, next()] }; }
    return left;
  };
  const primary = () => {
    const t = toks[p++];
    if (!t) throw new Error(`exact: unexpected end of "${src}"`);
    if (t.num != null) {
      // A written decimal is that decimal: 0.1 is 1/10, not the double nearest it.
      const [i, f = ''] = t.num.split('.');
      return { val: norm(BigInt(i + f), 10n ** BigInt(f.length)) };
    }
    if (t.op === '(') { const e = or(); expect(')'); return e; }
    if (t.name != null) {
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) { args.push(or()); while (isOp(',')) { p++; args.push(or()); } }
        expect(')');
        if (!FUNCS[t.name]) throw new Error(`exact: unknown function ${t.name}() in "${src}"`);
        return { fn: t.name, args };
      }
      return { name: t.name };
    }
    throw new Error(`exact: unexpected "${t.op}" in "${src}"`);
  };
  const power = () => {
    const base = primary();
    if (isOp('^')) { p++; return { op: '^', args: [base, unary()] }; }
    return base;
  };
  const unary = () => {
    if (isOp('-')) { p++; return { op: 'neg', args: [unary()] }; }
    if (isOp('!')) { p++; return { op: '!', args: [unary()] }; }
    if (isOp('+')) { p++; return unary(); }
    return power();
  };
  const product = binary(unary, ['*', '/']);
  const sum = binary(product, ['+', '-']);
  const compare = binary(sum, ['<', '<=', '>', '>=', '==', '!=']);
  const and = binary(compare, ['&&']);
  const or = binary(and, ['||']);
  const tree = or();
  if (p < toks.length) throw new Error(`exact: unexpected "${toks[p].op ?? toks[p].name ?? toks[p].num}" in "${src}"`);
  return tree;
}

const truth = (a) => a.n !== 0n;
const bool = (b) => (b ? ONE : ZERO);

const FUNCS = {
  floor: ([a]) => floorR(a),
  ceil: ([a]) => ceilR(a),
  round: ([a]) => floorR(add(a, { n: 1n, d: 2n })),        // halves round up
  abs: ([a]) => (a.n < 0n ? { n: -a.n, d: a.d } : a),
  min: (xs) => xs.reduce((m, x) => (cmp(x, m) < 0 ? x : m)),
  max: (xs) => xs.reduce((m, x) => (cmp(x, m) > 0 ? x : m)),
  clamp: ([x, lo, hi]) => (cmp(x, lo) < 0 ? lo : cmp(x, hi) > 0 ? hi : x),
  if: ([c, a, b]) => (truth(c) ? a : b),
};

const OPS = {
  '+': ([a, b]) => add(a, b), '-': ([a, b]) => sub(a, b),
  '*': ([a, b]) => mul(a, b), '/': ([a, b]) => div(a, b),
  '^': ([a, b]) => powR(a, b), neg: ([a]) => ({ n: -a.n, d: a.d }), '!': ([a]) => bool(!truth(a)),
  '<': ([a, b]) => bool(cmp(a, b) < 0), '<=': ([a, b]) => bool(cmp(a, b) <= 0),
  '>': ([a, b]) => bool(cmp(a, b) > 0), '>=': ([a, b]) => bool(cmp(a, b) >= 0),
  '==': ([a, b]) => bool(cmp(a, b) === 0), '!=': ([a, b]) => bool(cmp(a, b) !== 0),
  '&&': ([a, b]) => bool(truth(a) && truth(b)), '||': ([a, b]) => bool(truth(a) || truth(b)),
};

function evaluate(node, lookup) {
  if (node.val) return node.val;
  if (node.name != null) {
    const v = lookup(node.name);
    if (v == null) throw new Error(`exact: no value for "${node.name}"`);
    return rat(v);
  }
  const args = node.args.map(a => evaluate(a, lookup));
  return node.fn ? FUNCS[node.fn](args) : OPS[node.op](args);
}

const compiled = new Map();

/**
 * A formula compiled once: `(env) => rational`. `env` is an object whose values
 * are numbers or nested objects (`a.attack` reads env.a.attack), or a function
 * of the dotted name.
 */
export function formula(src) {
  let tree = compiled.get(src);
  if (!tree) { tree = parse(String(src)); compiled.set(src, tree); }
  return (env) => evaluate(tree, typeof env === 'function' ? env : (name) => dig(env, name));
}

function dig(env, name) {
  let v = env;
  for (const part of name.split('.')) { v = v?.[part]; if (v == null) return undefined; }
  return v;
}

/** Throws unless `src` is a formula this module can read. */
export function checkFormula(src) { parse(String(src)); }

/** `x × (num/den)` floored, exactly — for a whole stat scaled by a rational. */
export function scaleWhole(x, factor) { return whole(mul(rat(x), rat(factor))); }

export const R = { add, sub, mul, div, cmp, floor: floorR, ceil: ceilR, rat, toNumber, whole };
