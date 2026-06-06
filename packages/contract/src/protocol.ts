import { Schema } from "effect"
import { StopBoard, StopSelector } from "./domain.ts"

export const ClientMessage = Schema.TaggedUnion({
  Subscribe: { selectors: Schema.Array(StopSelector) },
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
