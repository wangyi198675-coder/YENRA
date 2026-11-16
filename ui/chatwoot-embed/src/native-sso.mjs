/**
 * Trusted original DSH Host -> native Chatwoot Platform API SSO.
 * Each Windows installation has its own Rails/PostgreSQL/Redis + owner User.
 * No browser password, copied cookie, second auth backend or sender.
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const setupScript = fileURLToPath(new URL('../tools/yenra-native-sso.rb', import.meta.url))
const secretFile = '/app/storage/yenra-desktop-platform-sso.json'
let pending = null
const name = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,110}$/
const distroName = /^[a-zA-Z][a-zA-Z0-9_-]{2,90}$/

export function nativeSsoOptions(env = process.env) {
  const distro = env.YENRA_CHATWOOT_WSL_DISTRO || 'YENRA_CHATWOOT'
  const container = env.YENRA_CHATWOOT_RAILS_CONTAINER || 'yenra-chatwoot-rails-1'
  const accountId = Number(env.YENRA_CHATWOOT_ACCOUNT_ID || 1)
  if (!distroName.test(distro) || !name.test(container) ||
      !Number.isSafeInteger(accountId) || accountId < 1) {
    throw Error('CHATWOOT_LOCAL_INSTANCE_CONFIG_INVALID')
  }
  return { distro, container, accountId }
}

function invokeWsl(distro, args, stdin = '') {
  return new Promise((resolve, reject) => {
    let output = '', stderrLength = 0
    const child = spawn('wsl.exe', ['-d', distro, '--', ...args], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 22000,
    })
    child.stdout.on('data', chunk => {
      output += String(chunk)
      if (output.length > 18000) child.kill()
    })
    child.stderr.on('data', chunk => {
      stderrLength += chunk.length
      if (stderrLength > 120000) child.kill()
    })
    child.on('error', () => reject(Error('CHATWOOT_LOCAL_WSL_UNAVAILABLE')))
    child.on('close', (code, signal) => {
      if (code !== 0 || signal) reject(Error('CHATWOOT_LOCAL_WSL_PROCESS_FAILED'))
      else resolve(output)
    })
    child.stdin.end(stdin)
  })
}

async function nativeCredentials({ distro, container, accountId }) {
  const read = async () => {
    const raw = await invokeWsl(distro, ['docker','exec',container,'cat',secretFile])
    const value = JSON.parse(raw.trim())
    if (value.account_id !== accountId ||
        !Number.isSafeInteger(value.user_id) || value.user_id < 1 ||
        typeof value.token !== 'string' || !/^[a-z0-9]{24,180}$/i.test(value.token)) {
      throw Error('CHATWOOT_LOCAL_PLATFORM_CREDENTIAL_INVALID')
    }
    return value
  }
  try { return await read() }
  catch {
    // First-run only. The script creates a LOCAL native User/Platform App
    // on a blank database, and refuses to claim existing non-YENRA accounts.
    const bootstrap = await readFile(setupScript, 'utf8')
    const output = await invokeWsl(distro, ['docker','exec','-i','-e',
      'YENRA_CHATWOOT_ACCOUNT_ID='+accountId,container,
      'bundle','exec','rails','runner','-'], bootstrap)
    if (!output.includes('YENRA_PLATFORM_SSO_BOOTSTRAP_READY')) {
      throw Error('CHATWOOT_NATIVE_PLATFORM_BOOTSTRAP_FAILED')
    }
    return read()
  }
}

export async function mintNativeChatwootSso({ origin, env = process.env,
  getCredentials = nativeCredentials, fetchImpl = fetch } = {}) {
  if (!origin || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    throw Error('CHATWOOT_ORIGIN_NOT_LOCAL')
  }
  // Coalesce only within the same DSH UI launch. No caching of SSO secrets.
  if (pending) return pending
  pending = (async () => {
    const options = nativeSsoOptions(env)
    const credentials = await getCredentials(options)
    const response = await fetchImpl(
      `http://127.0.0.1:31907/platform/api/v1/users/${credentials.user_id}/login`, {
        method:'GET',
        headers:{ api_access_token:credentials.token, accept:'application/json' },
        redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),
      })
    if (!response.ok) throw Error('CHATWOOT_PLATFORM_NATIVE_SSO_REJECTED')
    const data = await response.json()
    if (typeof data?.url !== 'string')throw Error('CHATWOOT_PLATFORM_URL_INVALID')
    const target=new URL(data.url)
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(target.origin) ||
        target.pathname!=='/app/login' ||
        !/^[a-f0-9]{64}$/.test(target.searchParams.get('sso_auth_token')??'') ||
        !(target.searchParams.get('email')??'').includes('@')) {
      throw Error('CHATWOOT_PLATFORM_SSO_SCOPE_INVALID')
    }
    // Chatwoot emits its configured Rails frontend origin; the existing YENRA
    // transparent iframe proxy is the only allowed browser origin.
    const browser=new URL('/app/login',origin)
    browser.searchParams.set('email',target.searchParams.get('email'))
    browser.searchParams.set('sso_auth_token',target.searchParams.get('sso_auth_token'))
    browser.searchParams.set('sso_account_id',String(options.accountId))
    return { url:browser.href, accountId:options.accountId }
  })()
  try { return await pending } finally { pending=null }
}
