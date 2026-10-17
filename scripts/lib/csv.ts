const QUOTE = 34 // "
const COMMA = 44
const CR = 13
const LF = 10

/**
 * Minimal RFC-4180 CSV reader (quotes, escaped quotes, newlines in quotes),
 * yielding rows lazily so a 100+ MB GTFS file never becomes one array.
 * Unquoted fields are sliced, not built char by char.
 */
export function* iterCsv(text: string): Generator<string[]> {
  let row: string[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    let field: string
    if (text.charCodeAt(i) === QUOTE) {
      field = ""
      i++
      for (;;) {
        const q = text.indexOf('"', i)
        if (q === -1) {
          field += text.slice(i)
          i = n
          break
        }
        field += text.slice(i, q)
        if (text.charCodeAt(q + 1) === QUOTE) {
          field += '"'
          i = q + 2
        } else {
          i = q + 1
          break
        }
      }
      // Anything between the closing quote and the delimiter is kept, as before.
      while (i < n) {
        const c = text.charCodeAt(i)
        if (c === COMMA || c === CR || c === LF) break
        field += text[i]
        i++
      }
    } else {
      const start = i
      while (i < n) {
        const c = text.charCodeAt(i)
        if (c === COMMA || c === CR || c === LF) break
        i++
      }
      field = text.slice(start, i)
    }
    row.push(field)
    if (i >= n) break
    const c = text.charCodeAt(i)
    i++
    if (c === COMMA) {
      if (i >= n) row.push("")
      continue
    }
    if (c === CR && text.charCodeAt(i) === LF) i++
    yield row
    row = []
  }
  if (row.length > 0) yield row
}

/** The whole file as rows. */
export const parseCsv = (text: string): string[][] => Array.from(iterCsv(text))
