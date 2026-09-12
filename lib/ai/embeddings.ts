// Embeddings client for RAG (Phase 5, decision 021, plans/active/business-mode/
// 05-rag-retrieval.md). Provider decided with Samir before writing this file
// (the plan doc's own "open decision this phase cannot skip"): DeepInfra —
// already an integrated vendor (DEEP_INFRA_API_KEY, the same OpenAI-compatible
// base URL lib/ai/router-config.ts already uses for chat completions), with a
// zero-retention / no-training-without-consent data policy, evaluated against
// the higher bar business documents need (decisions/021 §6). Model:
// BAAI/bge-m3 (1024-dim, 8k context, multilingual) — chosen for solid general
// quality at negligible cost; the vector column (migration 0051) is sized for
// it specifically, not the plan doc's own 1536 placeholder (that number was
// sized for OpenAI's embedding models, which this app doesn't use).
//
// Deliberately NOT routed through lib/ai/router.ts's multi-provider failover
// (decision 006/012/013 lanes): that machinery is built around chat
// completions with structured-output retries, and there is exactly one
// embeddings provider configured today — no lane to fail over to. A second
// provider is a real future step, not something to fake-engineer now.
//
// Server-only: never import this from a client component (the API key must
// never reach the browser).

import OpenAI from 'openai'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai/embeddings.ts is server-only and must not run in the browser')
}

const DEEPINFRA_EMBEDDINGS_BASE_URL = process.env.DEEPINFRA_BASE_URL ?? 'https://api.deepinfra.com/v1/openai'
export const EMBEDDING_MODEL = process.env.DEEPINFRA_EMBEDDING_MODEL ?? 'BAAI/bge-m3'
// Must match migration 0051's project_embeddings.embedding column exactly —
// changing the model above without also migrating this dimension breaks
// every existing row's vector arithmetic silently, not with a clear error.
export const EMBEDDING_DIMENSIONS = 1024

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.DEEP_INFRA_API_KEY
    if (!apiKey) throw new Error('DEEP_INFRA_API_KEY is not configured')
    client = new OpenAI({ apiKey, baseURL: DEEPINFRA_EMBEDDINGS_BASE_URL })
  }
  return client
}

// Embeds a batch of texts in ONE request (DeepInfra's OpenAI-compatible
// endpoint accepts an array input and embeds each independently — this is
// not concatenation). Caller decides batch size; kept simple since a single
// document's chunk count is already bounded (lib/ai/rag.ts's chunkText cap).
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const res = await getClient().embeddings.create({ model: EMBEDDING_MODEL, input: texts })
  // DeepInfra (like OpenAI) returns embeddings in the same order as the
  // input array, but keyed by `index` — sort defensively rather than assume.
  return res.data.slice().sort((a, b) => a.index - b.index).map((d) => d.embedding as number[])
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text])
  return embedding
}
