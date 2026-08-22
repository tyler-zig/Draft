/** Verifies the app relay activates on the production deploy itself. */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync(new URL('../app-content.js', import.meta.url), 'utf8')

function runAt(url, hasMarker = false) {
  const parsed = new URL(url)
  const sent = []
  const ctx = {
    URL,
    location: {
      hostname: parsed.hostname,
      origin: parsed.origin,
      protocol: parsed.protocol,
    },
    document: {
      visibilityState: 'visible',
      querySelector: () => hasMarker ? {} : null,
      addEventListener: () => {},
    },
    window: {
      addEventListener: () => {},
      postMessage: () => {},
    },
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: () => {} },
        sendMessage: (message, callback) => {
          sent.push(message)
          if (callback) callback(null)
        },
      },
    },
  }
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  return sent
}

const hosted = runAt('https://draft-bice-omega.vercel.app/')
if (!hosted.some((message) => message.type === 'REGISTER_APP_ORIGIN')) {
  throw new Error('production deployment did not activate the extension relay')
}
if (!hosted.some((message) => message.type === 'GET_ESPN_SNAPSHOT')) {
  throw new Error('production deployment did not request the ESPN snapshot')
}

const unrelated = runAt('https://unrelated-project.vercel.app/')
if (unrelated.length !== 0) {
  throw new Error('an unrelated Vercel deployment activated the extension relay')
}

console.log('app-content hosted relay: 3 passed, 0 failed')
