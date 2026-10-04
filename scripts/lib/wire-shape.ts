/**
 * The wire contract as a flat, diffable list of JSON paths — what the clients
 * (above all installed iOS builds, which never auto-update) can see or send.
 *
 * Every field becomes one entry, `path → the JSON forms it can take`:
 *
 *   "$.stops[].node": "null | number"
 *   "$<DeparturesUpdate>.reason": "null | string"
 *   "$.kind": "\"bus\" | \"metro\" | \"other\" | \"train\" | \"tram\""
 *
 * `absent` marks an optional key, `<Tag>` a variant of a `_tag` union, `[]` an
 * array element and `[0]` a tuple slot. The shapes are derived from the real
 * Effect schemas (via their JSON Schema / OpenAPI output), never written by hand.
 */
import { Schema } from "effect"
import { OpenApi } from "effect/http-api"
import { Api, ClientMessage, ServerMessage, StopIndex, StopsManifest } from "@app/contract"

/** surface ("GET /api/trips/{tripId} 200") → path → alternatives joined by " | " */
export type Surfaces = Record<string, Record<string, string>>

export interface WireShape {
  /** What the server sends; clients decode it. */
  readonly responses: Surfaces
  /** What clients send; the server decodes it. */
  readonly requests: Surfaces
}

/** Contract surfaces outside the HttpApi: the WebSocket and the static stop index. */
const extraResponses: Record<string, Schema.Top> = {
  "GET /data/stops-manifest.json": StopsManifest,
  "GET /data/stop-index-{hash}.json": StopIndex,
  "WS /api/ws server": ServerMessage,
}
const extraRequests: Record<string, Schema.Top> = {
  "WS /api/ws client": ClientMessage,
}

type JsonSchema = Record<string, any>
type Defs = Record<string, JsonSchema>
type Paths = Map<string, Set<string>>

export function describeWire(): WireShape {
  const responses: Surfaces = {}
  const requests: Surfaces = {}

  const doc = OpenApi.fromApi(Api) as unknown as JsonSchema
  const defs: Defs = doc.components?.schemas ?? {}
  for (const [route, ops] of Object.entries<JsonSchema>(doc.paths)) {
    for (const [method, op] of Object.entries<JsonSchema>(ops)) {
      const name = `${method.toUpperCase()} ${route}`
      const params: Paths = new Map()
      for (const p of op.parameters ?? []) {
        const path = `$.${p.in}.${p.name}`
        walk(p.schema, path, params, defs)
        if (!p.required) params.get(path)!.add("absent")
      }
      const body = op.requestBody?.content?.["application/json"]?.schema
      if (body !== undefined) walk(body, "$.body", params, defs)
      requests[name] = flatten(params)

      for (const [status, res] of Object.entries<JsonSchema>(op.responses)) {
        const schema = res.content?.["application/json"]?.schema
        const out: Paths = new Map()
        if (schema === undefined) out.set("$", new Set(["empty"]))
        else walk(schema, "$", out, defs)
        responses[`${name} ${status}`] = flatten(out)
      }
    }
  }

  for (const [name, schema] of Object.entries(extraResponses))
    responses[name] = describeSchema(schema)
  for (const [name, schema] of Object.entries(extraRequests))
    requests[name] = describeSchema(schema)

  return { responses: sortKeys(responses), requests: sortKeys(requests) }
}

/** One schema's encoded (wire) form as path → alternatives. */
export function describeSchema(schema: Schema.Top): Record<string, string> {
  const doc = Schema.toJsonSchemaDocument(schema) as unknown as JsonSchema
  const out: Paths = new Map()
  walk(doc.schema, "$", out, doc.definitions ?? {})
  return flatten(out)
}

// Schema.Number's JSON form also admits these strings; the worker never sends them.
const NON_FINITE = JSON.stringify(["Infinity", "-Infinity", "NaN"])

function walk(node: JsonSchema, path: string, out: Paths, defs: Defs): void {
  const leaves = alternatives(node, defs)
  const hasNumber = leaves.some((l) => l.type === "number" || l.type === "integer")
  const kept = leaves.filter((l) => !(hasNumber && JSON.stringify(l.enum) === NON_FINITE))
  const objects = kept.filter((l) => l.type === "object")
  const arrays = kept.filter((l) => l.type === "array")
  if (arrays.length > 1) throw new Error(`${path}: unions of arrays aren't supported`)

  const tokens = out.get(path) ?? new Set<string>()
  out.set(path, tokens)
  for (const leaf of kept) {
    if (leaf.type === "object") {
      if (objects.length === 1) {
        tokens.add("object")
        walkObject(leaf, path, out, defs)
      } else {
        const tag = leaf.properties?._tag?.enum
        if (!Array.isArray(tag) || tag.length !== 1) {
          throw new Error(`${path}: a union of objects needs a single-valued _tag on every member`)
        }
        tokens.add(`<${tag[0]}>`)
        walkObject(leaf, `${path}<${tag[0]}>`, out, defs)
      }
    } else if (leaf.type === "array") {
      tokens.add("array")
      if (Array.isArray(leaf.prefixItems)) {
        leaf.prefixItems.forEach((item: JsonSchema, i: number) =>
          walk(item, `${path}[${i}]`, out, defs),
        )
      }
      if (leaf.items !== undefined && leaf.items !== false) walk(leaf.items, `${path}[]`, out, defs)
    } else if (Array.isArray(leaf.enum)) {
      for (const value of leaf.enum) tokens.add(JSON.stringify(value))
    } else if ("const" in leaf) {
      tokens.add(JSON.stringify(leaf.const))
    } else if (typeof leaf.type === "string") {
      tokens.add(leaf.type)
    } else {
      tokens.add("any")
    }
  }
}

function walkObject(node: JsonSchema, path: string, out: Paths, defs: Defs): void {
  const required = new Set<string>(node.required ?? [])
  for (const [key, child] of Object.entries<JsonSchema>(node.properties ?? {})) {
    const childPath = `${path}.${key}`
    walk(child, childPath, out, defs)
    if (!required.has(key)) out.get(childPath)!.add("absent")
  }
}

/** Flattens $ref / anyOf / oneOf into the leaf schemas a value can match. */
function alternatives(node: JsonSchema, defs: Defs): JsonSchema[] {
  if (typeof node.$ref === "string") {
    const name = node.$ref.split("/").pop()!
    const target = defs[name]
    if (target === undefined) throw new Error(`unresolved $ref ${node.$ref}`)
    return alternatives(target, defs)
  }
  const union = node.anyOf ?? node.oneOf
  if (Array.isArray(union)) return union.flatMap((n: JsonSchema) => alternatives(n, defs))
  if (Array.isArray(node.type)) return node.type.map((type: string) => ({ ...node, type }))
  return [node]
}

function flatten(paths: Paths): Record<string, string> {
  const out: Record<string, string> = {}
  for (const path of [...paths.keys()].sort()) out[path] = [...paths.get(path)!].sort().join(" | ")
  return out
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

// MARK: - Compatibility

const tokensOf = (alts: string): string[] => alts.split(" | ")

/** `token` is one of `alts`, counting an integer as a number. */
const accepts = (alts: readonly string[], token: string): boolean =>
  alts.includes(token) || (token === "integer" && alts.includes("number"))

/** The path one level up: "$.a[].b" → "$.a[]", "$<Tag>" → "$". */
export const parentPath = (path: string): string | undefined => {
  const m = /(\.[^.[<]+|\[\d*\]|<[^>]+>)$/.exec(path)
  return m === null ? undefined : path.slice(0, m.index)
}

const isUnder = (path: string, ancestor: string): boolean =>
  path.startsWith(ancestor) && /^[.[<]/.test(path.slice(ancestor.length))

/** `path` is in the shape — a `_tag` variant ("$<Tag>") lives as a token of its union. */
const has = (paths: Record<string, string>, path: string): boolean => {
  if (path in paths) return true
  const variant = /^(.*)(<[^>]+>)$/.exec(path)
  return (
    variant !== null &&
    has(paths, variant[1]!) &&
    tokensOf(paths[variant[1]!] ?? "").includes(variant[2]!)
  )
}

/** Some `_tag` variant `path` sits under no longer exists. */
const inDroppedVariant = (paths: Record<string, string>, path: string): boolean => {
  for (let p = parentPath(path); p !== undefined; p = parentPath(p)) {
    if (p.endsWith(">") && !has(paths, p)) return true
  }
  return false
}

/**
 * Changes from `before` to `after` that would break a client already in use:
 *
 * - responses (clients decode): a surface or field disappears, or a field can
 *   now take a form it couldn't before — another type, null, absent, a new
 *   enum literal or `_tag` variant.
 * - requests (the server decodes what old clients still send): a surface
 *   disappears, a field stops accepting a form it used to, or a new required
 *   field appears.
 *
 * Purely additive changes (a new endpoint, a new response field, a new
 * optional request field) pass.
 */
export function breakingChanges(before: WireShape, after: WireShape): string[] {
  const problems: string[] = []

  for (const [surface, paths] of Object.entries(before.responses)) {
    const next = after.responses[surface]
    if (next === undefined) {
      problems.push(`${surface}: response removed`)
      continue
    }
    const removed: string[] = []
    for (const [path, alts] of Object.entries(paths)) {
      const nextAlts = next[path]
      if (nextAlts === undefined) {
        // a variant the server stopped sending can't trip up a client
        if (inDroppedVariant(next, path)) continue
        if (!removed.some((r) => isUnder(path, r))) {
          removed.push(path)
          problems.push(`${surface} ${path}: removed`)
        }
        continue
      }
      const old = tokensOf(alts)
      const added = tokensOf(nextAlts).filter((t) => !accepts(old, t))
      if (added.length > 0) {
        problems.push(`${surface} ${path}: can now be ${added.join(" | ")} (was ${alts})`)
      }
    }
  }

  for (const [surface, paths] of Object.entries(before.requests)) {
    const next = after.requests[surface]
    if (next === undefined) {
      problems.push(`${surface}: request removed`)
      continue
    }
    for (const [path, alts] of Object.entries(paths)) {
      const nextAlts = next[path]
      if (nextAlts === undefined) continue // the server ignores keys it doesn't know
      const now = tokensOf(nextAlts)
      const dropped = tokensOf(alts).filter((t) => !accepts(now, t))
      if (dropped.length > 0) {
        problems.push(
          `${surface} ${path}: no longer accepts ${dropped.join(" | ")} (now ${nextAlts})`,
        )
      }
    }
    for (const [path, alts] of Object.entries(next)) {
      if (path in paths || tokensOf(alts).includes("absent")) continue
      const parent = parentPath(path)
      // under a new optional parent, a required child is fine: old clients send neither
      if (parent === undefined || has(paths, parent)) {
        problems.push(`${surface} ${path}: new required field (${alts})`)
      }
    }
  }

  return problems
}
