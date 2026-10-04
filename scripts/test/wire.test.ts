import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { FIXTURES_DIR, fixtureText, fixtures } from "../lib/wire-fixtures.ts"
import { breakingChanges, describeWire, parentPath, type WireShape } from "../lib/wire-shape.ts"

const SHAPE_FILE = "packages/contract/wire-shape.json"
const REGENERATE = "out of date — run `bun run contract:write` and commit the result"

describe("committed contract files", () => {
  const shape = describeWire()

  it(`${SHAPE_FILE} matches the schemas`, () => {
    const committed = JSON.parse(readFileSync(SHAPE_FILE, "utf8"))
    expect(committed, `${SHAPE_FILE} is ${REGENERATE}`).toEqual(shape)
  })

  it(`${FIXTURES_DIR} matches the samples`, () => {
    const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"))
    expect([...files].sort(), `fixture list is ${REGENERATE}`).toEqual(
      fixtures.map((f) => `${f.name}.json`).sort(),
    )
    for (const f of fixtures) {
      const text = readFileSync(`${FIXTURES_DIR}/${f.name}.json`, "utf8")
      expect(text, `${f.name}.json is ${REGENERATE}`).toBe(fixtureText(f))
    }
  })

  it("fixtures show every field of their surfaces in every form", () => {
    const all = { ...shape.responses, ...shape.requests }
    const seen = new Map<string, Map<string, Set<string>>>()
    for (const f of fixtures) {
      for (const surface of f.surfaces) {
        const paths = all[surface]
        expect(paths, `${f.name}: unknown surface ${surface}`).toBeDefined()
        const observed = seen.get(surface) ?? new Map<string, Set<string>>()
        seen.set(surface, observed)
        observe(f.json, "$", paths!, observed)
      }
    }
    const missing: string[] = []
    for (const [surface, observed] of seen) {
      for (const [path, alts] of Object.entries(all[surface]!)) {
        const forms = new Set(
          alts
            .split(" | ")
            .map(form)
            .filter((f) => f !== "absent"),
        )
        for (const f of forms)
          if (!observed.get(path)?.has(f)) missing.push(`${surface} ${path}: ${f}`)
      }
    }
    expect(missing, "add samples in scripts/lib/wire-fixtures.ts").toEqual([])
  })
})

/** A shape token's JSON kind: literals collapse to their type, `<Tag>` stays. */
const form = (token: string): string => {
  if (token.startsWith("<") || token === "absent") return token
  if (token === "integer") return "number"
  if (token.startsWith('"')) return "string"
  if (/^-?\d/.test(token)) return "number"
  return token
}

/** Records which forms each path takes in `value`, following the shape's path scheme. */
function observe(
  value: unknown,
  path: string,
  paths: Record<string, string>,
  out: Map<string, Set<string>>,
): void {
  const record = (p: string, f: string) => {
    const s = out.get(p) ?? new Set<string>()
    s.add(f)
    out.set(p, s)
  }
  if (value === null) return record(path, "null")
  if (Array.isArray(value)) {
    record(path, "array")
    if (`${path}[]` in paths) value.forEach((v) => observe(v, `${path}[]`, paths, out))
    else value.forEach((v, i) => observe(v, `${path}[${i}]`, paths, out))
    return
  }
  if (typeof value === "object") {
    const tag = (value as { _tag?: unknown })._tag
    let at = path
    if (typeof tag === "string" && paths[path]?.split(" | ").includes(`<${tag}>`)) {
      record(path, `<${tag}>`)
      at = `${path}<${tag}>`
    } else {
      record(path, "object")
    }
    for (const [k, v] of Object.entries(value)) observe(v, `${at}.${k}`, paths, out)
    return
  }
  record(path, typeof value)
}

describe("breakingChanges", () => {
  const base: WireShape = {
    responses: {
      "GET /a 200": {
        $: "object",
        "$.id": "string",
        "$.kind": '"bus" | "tram"',
        "$.n": "number",
        "$.items": "array",
        "$.items[]": "object",
        "$.items[].x": "number",
      },
      "WS server": { $: "<A> | <B>", "$<A>._tag": '"A"', "$<B>._tag": '"B"' },
    },
    requests: {
      "GET /a": { "$.query.q": "string" },
      "WS client": { $: "object", "$.node": "number", "$.stops": "array | null" },
    },
  }
  const change = (edit: (s: WireShape) => void): string[] => {
    const next: WireShape = structuredClone(base)
    edit(next)
    return breakingChanges(base, next)
  }

  it("passes an unchanged or purely additive contract", () => {
    expect(breakingChanges(base, base)).toEqual([])
    expect(
      change((s) => {
        s.responses["GET /a 200"]!["$.extra"] = "null | string"
        s.responses["GET /b 200"] = { $: "object" }
        s.requests["GET /a"]!["$.query.page"] = "absent | number"
        s.requests["WS client"]!["$.stops"] = "absent | array | null"
        s.requests["WS client"]!["$.node"] = "number | string"
      }),
    ).toEqual([])
  })

  it("flags response fields that disappear, once per subtree", () => {
    expect(
      change((s) => {
        const r = s.responses["GET /a 200"]!
        delete r["$.id"]
        delete r["$.items"]
        delete r["$.items[]"]
        delete r["$.items[].x"]
      }),
    ).toEqual(["GET /a 200 $.id: removed", "GET /a 200 $.items: removed"])
    expect(change((s) => delete s.responses["GET /a 200"])).toEqual([
      "GET /a 200: response removed",
    ])
  })

  it("flags response fields that can take a new form", () => {
    expect(
      change((s) => {
        const r = s.responses["GET /a 200"]!
        r["$.id"] = "number"
        r["$.n"] = "null | number"
        r["$.kind"] = '"bus" | "metro" | "tram"'
        r["$.items[].x"] = "absent | number"
        s.responses["WS server"]!.$ = "<A> | <B> | <C>"
      }),
    ).toEqual([
      "GET /a 200 $.id: can now be number (was string)",
      'GET /a 200 $.kind: can now be "metro" (was "bus" | "tram")',
      "GET /a 200 $.n: can now be null (was number)",
      "GET /a 200 $.items[].x: can now be absent (was number)",
      "WS server $: can now be <C> (was <A> | <B>)",
    ])
  })

  it("lets a response number narrow to an integer", () => {
    expect(change((s) => (s.responses["GET /a 200"]!["$.n"] = "integer"))).toEqual([])
  })

  it("flags requests the server would now reject", () => {
    expect(
      change((s) => {
        s.requests["WS client"]!["$.stops"] = "array"
        s.requests["WS client"]!["$.node"] = "integer"
        s.requests["WS client"]!["$.session"] = "string"
        delete s.requests["GET /a"]
      }),
    ).toEqual([
      "GET /a: request removed",
      "WS client $.node: no longer accepts number (now integer)",
      "WS client $.stops: no longer accepts null (now array)",
      "WS client $.session: new required field (string)",
    ])
  })

  it("flags a new required field in a request variant, but not in a new variant", () => {
    const tagged = (edit: (s: WireShape) => void): string[] => {
      const before: WireShape = {
        responses: {},
        requests: { WS: { $: "<A>", "$<A>._tag": '"A"' } },
      }
      const after: WireShape = structuredClone(before)
      edit(after)
      return breakingChanges(before, after)
    }
    expect(tagged((s) => (s.requests["WS"]!["$<A>.session"] = "string"))).toEqual([
      "WS $<A>.session: new required field (string)",
    ])
    expect(
      tagged((s) => {
        s.requests["WS"]!.$ = "<A> | <B>"
        s.requests["WS"]!["$<B>._tag"] = '"B"'
      }),
    ).toEqual([])
  })

  it("doesn't report the fields of a response variant that was dropped", () => {
    expect(
      change((s) => {
        s.responses["WS server"]!.$ = "<A>"
        delete s.responses["WS server"]!["$<B>._tag"]
      }),
    ).toEqual([])
  })

  it("allows required fields inside a new optional request field", () => {
    expect(
      change((s) => {
        s.requests["WS client"]!["$.filter"] = "absent | object"
        s.requests["WS client"]!["$.filter.mode"] = "string"
      }),
    ).toEqual([])
  })
})

describe("parentPath", () => {
  it("strips one segment", () => {
    expect(parentPath("$.a[].b")).toBe("$.a[]")
    expect(parentPath("$.a[]")).toBe("$.a")
    expect(parentPath("$.shape[][0]")).toBe("$.shape[]")
    expect(parentPath("$<Tag>")).toBe("$")
    expect(parentPath("$<Tag>.x")).toBe("$<Tag>")
    expect(parentPath("$")).toBeUndefined()
  })
})
