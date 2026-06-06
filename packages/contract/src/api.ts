import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"

export const HealthResponse = Schema.Struct({
  ok: Schema.Boolean,
  version: Schema.String,
})

export const Api = HttpApi.make("tablo").add(
  HttpApiGroup.make("system").add(
    HttpApiEndpoint.get("health", "/api/health", { success: HealthResponse }),
  ),
)
