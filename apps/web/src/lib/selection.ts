import { MAX_SELECTORS, selectorKey, type StopSelector } from "@app/contract"
import type { Selection } from "./url.ts"

/**
 * Add a stop to the front of the selection — newest-on-top, so the just-added
 * stop leads the board. Capped at MAX_SELECTORS (the wire protocol's Subscribe
 * limit; never build a selection the encoder would reject): at the cap this
 * returns the previous array unchanged (same reference), so callers can detect
 * the no-op and skip their side effects.
 */
export const addSelection = (
  prev: ReadonlyArray<Selection>,
  selector: StopSelector,
  name: string,
): ReadonlyArray<Selection> => (prev.length >= MAX_SELECTORS ? prev : [{ selector, name }, ...prev])

/** Drop the selection whose selector matches `key`. */
export const removeSelection = (
  prev: ReadonlyArray<Selection>,
  key: string,
): ReadonlyArray<Selection> => prev.filter((s) => selectorKey(s.selector) !== key)
