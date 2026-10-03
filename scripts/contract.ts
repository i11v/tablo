/**
 * The wire contract between the backend and its clients (see docs/DEPLOY.md#ios-compatibility).
 *
 *   bun scripts/contract.ts write          regenerate packages/contract/wire-shape.json
 *                                          and the iOS fixtures from the schemas
 *   bun scripts/contract.ts check [ref]    fail if the contract breaks clients already
 *                                          installed, compared with `ref` (default origin/main)
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { $ } from "bun"
import { FIXTURES_DIR, fixtureText, fixtures } from "./lib/wire-fixtures.ts"
import { breakingChanges, describeWire, type WireShape } from "./lib/wire-shape.ts"

export const SHAPE_FILE = "packages/contract/wire-shape.json"

const [command, ref = "origin/main"] = process.argv.slice(2)

if (command === "write") {
  await writeFile(SHAPE_FILE, JSON.stringify(describeWire(), null, 2) + "\n")
  await mkdir(FIXTURES_DIR, { recursive: true })
  for (const file of await readdir(FIXTURES_DIR)) {
    if (file.endsWith(".json")) await rm(`${FIXTURES_DIR}/${file}`)
  }
  for (const f of fixtures) await writeFile(`${FIXTURES_DIR}/${f.name}.json`, fixtureText(f))
  console.log(`wrote ${SHAPE_FILE} and ${fixtures.length} fixtures in ${FIXTURES_DIR}`)
} else if (command === "check") {
  const base = await $`git show ${ref}:${SHAPE_FILE}`.quiet().nothrow()
  if (base.exitCode !== 0) {
    console.log(`${ref} has no ${SHAPE_FILE} yet — nothing to compare against.`)
    process.exit(0)
  }
  const problems = breakingChanges(JSON.parse(base.stdout.toString()) as WireShape, describeWire())
  if (problems.length === 0) {
    console.log(`Wire contract is backward compatible with ${ref}.`)
    process.exit(0)
  }
  console.error(`Wire contract changes that break clients built against ${ref}:\n`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error(
    "\nInstalled iOS builds never update, so keep the old shape working: add a new field" +
      "\ninstead of renaming or retyping one. If the app provably tolerates this change" +
      "\n(check ios/Tablo/API/Wire.swift), add the `contract-break` label to the PR.",
  )
  process.exit(1)
} else {
  console.error("usage: bun scripts/contract.ts write | check [git-ref]")
  process.exit(2)
}
