// source.js — an appfr DataSource over the catalog's rows, held in memory.
//
// The catalog is small (a few hundred records), so the console fetches it whole
// and filters, sorts and pages here, with appfr's own expression language and
// facet matching. One departure: appfr matches `field:value` as a substring, so
// the scope term `game:"cs"` would also take in csmini. The `game` join key is
// matched EXACTLY here — it names one game, never a family of them.

import { columnsFor, cellValue, findSort, matchesExpression, matchesFacets, parseExpression } from 'header-content-layout'

const SCOPE_FIELD = 'game'

function isScopeTerm(term) {
  return term.kind === 'field' && term.field.toLowerCase() === SCOPE_FIELD && (term.comparator === ':' || term.comparator === '=')
}

function matchesGame(term, row) {
  const wanted = term.value.toLowerCase()
  const exact = (name) => {
    const value = String(name).toLowerCase()
    if (!wanted.includes('*')) return value === wanted
    const pattern = wanted.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${pattern}$`).test(value)
  }
  const game = row.fields[SCOPE_FIELD]
  return Array.isArray(game) ? game.some(exact) : game != null && exact(game)
}

function matches(expression, row, entity) {
  if (!expression.length) return true
  return expression.some((group) =>
    group.every((term) => (isScopeTerm(term) ? matchesGame(term, row) : matchesExpression([[term]], row, entity))),
  )
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
