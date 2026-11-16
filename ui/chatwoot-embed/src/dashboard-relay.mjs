/** Runs only inside Chatwoot's official Dashboard App iframe. No DSH API access. */
export function dashboardRelayRuntime({ chatwootOrigin, topOrigin }) {
  if (window.parent === window || window.top === window.parent) return
  const instance = crypto.randomUUID()
  let pending = false
  const send = context => window.top.postMessage({ type: 'yenra:cw-context:v1', instance, context }, topOrigin)
  function positive(value) { return Number.isSafeInteger(value) && value > 0 }
  function receive(event) {
    if (event.source !== window.parent || event.origin !== chatwootOrigin || !pending) return
    let payload
    try { payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data } catch { return }
    if (payload?.event !== 'appContext') return
    pending = false
    const conversation = payload.data?.conversation, contact = payload.data?.contact
    const context = { accountId: conversation?.account_id, conversationId: conversation?.id,
      inboxId: conversation?.inbox_id, contactId: contact?.id, identifier: contact?.identifier }
    if (![context.accountId, context.conversationId, context.inboxId, context.contactId].every(positive) ||
      typeof context.identifier !== 'string' || !/^yenra-[a-f0-9]{40}$/.test(context.identifier)) { send(null); return }
    // Deliberately omit messages, currentAgent, email, tokens and all other fields.
    send(context)
  }
  function request() { pending = true; window.parent.postMessage('chatwoot-dashboard-app:fetch-info', chatwootOrigin) }
  window.addEventListener('message', receive)
  const timer = setInterval(request, 1000)
  window.addEventListener('pagehide', () => { clearInterval(timer); send(null) }, { once: true })
  request()
}

export function renderDashboardRelay({ chatwootOrigin, topOrigin, nonce }) {
  const config = JSON.stringify({ chatwootOrigin, topOrigin }).replace(/</g, '\\u003c')
  return `<!doctype html><html><meta charset="utf-8"><title>YENRA contact context relay</title><body><p>YENRA 联系人上下文连接。返回消息标签或切换会话后，旧绑定将在 3.5 秒租约到期后清除。此页不发送消息。</p><script nonce="${nonce}">(${dashboardRelayRuntime.toString()})(${config});</script></body></html>`
}
