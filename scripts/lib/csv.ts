const QUOTE = 34 // "
const COMMA = 44
const CR = 13
const LF = 10

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, newlines in quotes). */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (inQuotes) {
      if (c === QUOTE) {
        if (text.charCodeAt(i + 1) === QUOTE) {
          field += text[i]
          i++
        } else inQuotes = false
      } else field += text[i]
    } else if (c === QUOTE) inQuotes = true
    else if (c === COMMA) {
      row.push(field)
      field = ""
    } else if (c === CR || c === LF) {
      if (c === CR && text.charCodeAt(i + 1) === LF) i++
      row.push(field)
      field = ""
      rows.push(row)
      row = []
    } else field += text[i]
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
