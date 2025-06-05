import { docs } from "../../.source"
import { loader } from "fumadocs-core/source"

export const source: ReturnType<typeof loader> = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
})