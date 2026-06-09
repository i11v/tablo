import { Schema } from "effect"
import { MAX_SELECTORS, StopBoard, StopSelector } from "./domain.ts"

export const ClientMessage = Schema.TaggedUnion({
  Subscribe: {
    // Bounded: see MAX_SELECTORS in domain.ts. The worker replies with a
    // ServerError frame when the cap is exceeded (decode failure path).
    selectors: Schema.Array(StopSelector).check(Schema.isMaxLength(MAX_SELECTORS)),
  },
  Unsubscribe: {},
})
export type ClientMessage = typeof ClientMessage.Type

export const ServerMessage = Schema.TaggedUnion({
  DeparturesUpdate: {
    boards: Schema.Array(StopBoard),
    generatedAt: Schema.String,
    degraded: Schema.Boolean,
    reason: Schema.NullOr(Schema.String),
  },
  ServerError: { message: Schema.String },
})
export type ServerMessage = typeof ServerMessage.Type

/** String⇄message codecs for the WebSocket wire. */
export const ClientMessageJson = Schema.fromJsonString(ClientMessage)
export const ServerMessageJson = Schema.fromJsonString(ServerMessage)
