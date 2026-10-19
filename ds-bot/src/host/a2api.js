// Whether a local OpenAI-compatible gateway is answering at the Agent2API
// address. The check sends no key and returns no response body.

export const A2API_MODELS_URL = 'http://127.0.0.1:3065/v1/models'
const TIMEOUT_MS = 2_000
const BODY_MAX = 65_536
const ID_MAX = 40

const modelId = (value) => (typeof value === 'string' && /^[\w.:@/-]{1,80}$/.test(value) ? value : undefined)

export async function probeA2api({ fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const url = A2API_MODELS_URL
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (response.status >= 300 && response.status < 400) return { ok: false, url, status: response.status, models: [], error: 'redirect' }
    const raw = typeof response.text === 'function' ? await response.text() : ''
    let parsed
    try { parsed = JSON.parse(String(raw).slice(0, BODY_MAX)) } catch { parsed = undefined }
    const list = Array.isArray(parsed?.data) ? parsed.data : []
    const models = list.map(item => modelId(typeof item === 'string' ? item : item?.id)).filter(Boolean).slice(0, ID_MAX)
    if (!response.ok) return { ok: false, url, status: response.status, models: [], error: `http ${response.status}` }
    if (!Array.isArray(parsed?.data)) return { ok: false, url, status: response.status, models: [], error: 'not a model list' }
    return { ok: true, url, status: response.status, models }
  } catch (error) {
    const aborted = error?.name === 'AbortError' || error?.name === 'TimeoutError'
    return { ok: false, url, status: 0, models: [], error: aborted ? 'timed out' : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}
