// source.js — an appfr DataSource over the catalog's rows, held in memory.
//
// The catalog is small (a few hundred records), so the console fetches it whole
// and filters, sorts and pages here, with appfr's own expression language and
// facet matching. One departure: the scope terms appfr writes when narrowing to
// a game or a scenario are `game:"cs"` and `scenario:"cs/dust2"`, and `:` is
// containment, which would also take in csmini. A join key is matched EXACTLY
// here — it names one record, never a family of them — under appfr's other
// rules for a field: `-game:x` (a ⌘-press) leaves x out, and several positive
// terms on one key in a group are any-of. A row without the key never matches a
// term on it (appfr counts an unknown field as a match), so a scenario narrowed
// to keeps its sessions and recordings, not every unit there is.

import { columnsFor, cellValue, findSort, matchesExpression, matchesFacets, parseExpression } from 'header-content-layout'

const SCOPE_FIELDS = ['game', 'scenario']

/** The join key a term narrows on, or null for any other term. */
function scopeFieldOf(term) {
  if (term.kind !== 'field' || (term.comparator !== ':' && term.comparator !== '=')) return null
  const field = term.field.toLowerCase()
  return SCOPE_FIELDS.includes(field) ? field : null
}

function matchesKey(term, row) {
  const wanted = term.value.toLowerCase()
  const exact = (name) => {
    const value = String(name).toLowerCase()
    if (!wanted.includes('*')) return value === wanted
    const pattern = wanted.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${pattern}$`).test(value)
  }
  const key = row.fields[scopeFieldOf(term)]
  return Array.isArray(key) ? key.some(exact) : key != null && exact(key)
}

function matchesGroup(group, row, entity) {
  for (const field of SCOPE_FIELDS) {
    const terms = group.filter((term) => scopeFieldOf(term) === field)
    const wanted = terms.filter((term) => !term.negated)
    if (wanted.length && !wanted.some((term) => matchesKey(term, row))) return false
    if (terms.some((term) => term.negated && matchesKey(term, row))) return false
  }
  const rest = group.filter((term) => !scopeFieldOf(term))
  // The rest of the group goes to appfr whole, so its own rules across terms
  // (any-of on a repeated field) hold for them as written.
  return !rest.length || matchesExpression([rest], row, entity)
}

/**
 * What a query's `field:x` terms name, in any alternative and not left out,
 * lowercased — the games, or the scenarios, a summary card is drawn for.
 */
export function namedIn(expr, field) {
  const named = new Set()
  for (const group of parseExpression(expr ?? '')) {
    for (const term of group) {
      if (term.kind !== 'field' || term.negated || term.field.toLowerCase() !== field) continue
      if (term.comparator === ':' || term.comparator === '=') named.add(String(term.value).toLowerCase())
    }
  }
  return named
}

function matches(expression, row, entity) {
  if (!expression.length) return true
  return expression.some((group) => matchesGroup(group, row, entity))
}

/**
 * Ascending is the order a sort's name reads in: names A→Z, numbers low→high,
 * and `age` (a date column) youngest first. Empty values sort last either way.
 */
function comparatorFor(columns, sortKey, dir) {
  const column = columns.find((candidate) => candidate.sort === sortKey)
  if (!column) return () => 0
  const sign = dir === 'desc' ? -1 : 1
  const numeric = column.kind === 'number' || column.role === 'metric'
  const dated = column.kind === 'date'
  const key = (row) => {
    const value = cellValue(column, row)
    if (value == null || value === '') return null
    if (numeric) return Number(value)
    if (dated) return -Date.parse(String(value))
    return String(value).toLowerCase()
  }
  // Rows that tie — every unit of one game, under a sort by game — fall into
  // name order rather than whatever order the server listed them in.
  const byName = (a, b) => String(a.fields.name ?? '').localeCompare(String(b.fields.name ?? ''), 'en', { numeric: true })
  return (a, b) => {
    const left = key(a)
    const right = key(b)
    if (left === null || right === null) return left === right ? byName(a, b) : left === null ? 1 : -1
    const order = typeof left === 'number' ? left - right : left.localeCompare(right, 'en', { numeric: true })
    return sign * order || byName(a, b)
  }
}

/** @param rowsByEntity  buildRows() output */
export function createCatalogSource(rowsByEntity) {
  return {
    query({ query, schema, entity, limit, offset }) {
      const expression = parseExpression(query.expr)
      const scope = entity ? [entity] : schema.entities
      let population = 0
      const matched = []
      for (const candidate of scope) {
        for (const row of rowsByEntity[candidate.key] ?? []) {
          population += 1
          // Facets belong to one entity, so they apply only once it is chosen.
          if (entity && !matchesFacets(row, query.facets)) continue
          if (matches(expression, row, candidate)) matched.push(row)
        }
      }
      // The query's sort may be one this entity does not offer (the home
      // screen's `age`, on a card of games): it then falls back to the
      // entity's own first sort, exactly as the shell's controls do.
      const sort = findSort(entity, query.sort, schema).key
      matched.sort(comparatorFor(columnsFor(schema, entity), sort, query.dir))
      return {
        rows: matched.slice(offset, offset + limit),
        total: matched.length,
        unfiltered: matched.length === population,
      }
    },
  }
}
