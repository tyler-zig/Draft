/**
 * App tabs the extension may relay snapshots to.
 *
 * Loopback stays http-only so a lookalike host cannot ride the local match.
 * The production deploy is explicit: treating every *.vercel.app project as
 * Draft Assistant would let an unrelated deployment receive draft snapshots.
 * Custom domains can be added later through REGISTER_APP_ORIGIN once that
 * origin has been granted.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const HOSTED_APP_HOSTS = new Set(['draft-bice-omega.vercel.app'])
const DEFAULT_APP_URL = 'http://localhost:5173/'

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname)
}

function isHostedAppHost(hostname) {
  return HOSTED_APP_HOSTS.has(hostname)
}

function isAppTab(url, extraOrigins) {
  try {
    const parsed = new URL(url)
    if (isLoopbackHost(parsed.hostname)) return parsed.protocol === 'http:'
    if (parsed.protocol !== 'https:') return false
    if (isHostedAppHost(parsed.hostname)) return true
    return Array.isArray(extraOrigins) && extraOrigins.includes(parsed.origin)
  } catch {
    return false
  }
}
