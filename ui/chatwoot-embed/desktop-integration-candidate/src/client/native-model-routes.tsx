/**
 * YENRA native "模型与推理" settings section.
 *
 * Reuses the SAME Host endpoints of the third-party `dsh-model-settings`
 * plugin (/api/model-settings/state, /save, /apply-current) instead of
 * forking its client bundle or its request-routing logic. The third-party
 * footer shortcut is hidden by the caller; the Host-side request waterfall,
 * settings namespaces and hot-reload semantics stay untouched.
 *
 * The three consumers follow the plugin's contract:
 *   main     — new-session default (agent-default-model)
 *   subagent — subagent / workflow children (model-settings.subagent)
 *   goal     — goal-round turns (model-settings.goal)
 * Save writes config + switches the current conversation; "apply to this
 * conversation only" switches just the main route without a config write.
 */
import React, { useCallback, useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../../../../upstream/official-source/packages/client/ui-settings/src/client/contract/slots'

type Selection = { provider: string; model: string; reasoningEffort: string }
type SlottedSelection = Selection & { enabled: boolean }
type Draft = { main: Selection; subagent: SlottedSelection; goal: SlottedSelection }
type ModelInfo = { id: string; name: string; reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string } }
type CatalogGroup = { id: string; name: string; models: ModelInfo[] }

type StatePayload = {
  ok: boolean
  defaultModel?: Selection | null
  subagent?: Selection | null
  goal?: Selection | null
  catalog?: { groups?: CatalogGroup[]; failures?: unknown[] }
}

const empty = (): Selection => ({ provider: '', model: '', reasoningEffort: '' })

function draftFromState(s: StatePayload): Draft {
  const sel = (v: Selection | null | undefined) => ({
    provider: v?.provider ?? '', model: v?.model ?? '', reasoningEffort: v?.reasoningEffort ?? '',
  })
  return {
    main: sel(s.defaultModel),
    subagent: { ...sel(s.subagent), enabled: s.subagent != null },
    goal: { ...sel(s.goal), enabled: s.goal != null },
  }
}

function clean(s: Selection) {
  return {
    provider: s.provider,
    model: s.model,
    ...(s.reasoningEffort !== '' ? { reasoningEffort: s.reasoningEffort } : {}),
  }
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || payload?.ok !== true) {
    throw new Error(payload?.message ?? `HTTP ${res.status}`)
  }
  return payload
}

function RouteCard(props: {
  title: string
  hint: string
  slot: Selection
  canToggle: boolean
  enabled: boolean
  groups: CatalogGroup[]
  onToggle?: (on: boolean) => void
  onChange: (next: Selection) => void
}) {
  const { title, hint, slot, canToggle, enabled, groups, onToggle, onChange } = props
  const group = groups.find(g => g.id === slot.provider)
  const models = group?.models ?? []
  const model = models.find(m => m.id === slot.model)
  const efforts = model?.reasoning?.efforts ?? []
  const disabled = canToggle && !enabled
  return (
    <section className="yenra-mr-card" data-disabled={disabled || undefined}>
      <header className="yenra-mr-card-head">
        <div className="yenra-mr-card-title">
          <strong>{title}</strong>
          <span>{hint}</span>
        </div>
        {canToggle && (
          <label className="yenra-mr-switch" title={enabled ? '启用覆盖' : '跟随主模型默认'}>
            <input type="checkbox" checked={enabled} disabled={disabled && false}
              onChange={e => onToggle?.(e.target.checked)} />
            <span className="yenra-mr-switch-track" aria-hidden="true" />
          </label>
        )}
      </header>
      {disabled ? (
        <p className="yenra-mr-inherit">跟随主模型默认路由，不单独覆盖。</p>
      ) : (
        <div className="yenra-mr-fields">
          <label className="yenra-mr-field">
            <span>提供方</span>
            <select value={slot.provider} disabled={disabled}
              onChange={e => onChange({ provider: e.target.value, model: '', reasoningEffort: '' })}>
              <option value="">选择提供方…</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label className="yenra-mr-field">
            <span>模型</span>
            <select value={slot.model} disabled={disabled || !slot.provider}
              onChange={e => onChange({ ...slot, model: e.target.value, reasoningEffort: '' })}>
              <option value="">选择模型…</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="yenra-mr-field">
            <span>推理强度</span>
            <select value={slot.reasoningEffort} disabled={disabled || !slot.model}
              onChange={e => onChange({ ...slot, reasoningEffort: e.target.value })}>
              <option value="">跟随模型默认</option>
              {efforts.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        </div>
      )}
    </section>
  )
}

export function NativeModelRoutesSection({ close, useSessions }: PropsRuntime<'settings.section'>) {
  const [state, setState] = useState<StatePayload | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const sessionId = useSessions((s: any) => s?.current ?? s?.currentAddress?.childSessionId)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/model-settings/state', { headers: { accept: 'application/json' } })
      const payload: StatePayload = await res.json().catch(() => null)
      if (!res.ok || payload?.ok !== true) throw new Error(payload?.message ?? `HTTP ${res.status}`)
      setState(payload)
      setDraft(current => current ?? draftFromState(payload))
      setNotice('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const groups: CatalogGroup[] = state?.catalog?.groups ?? []

  const apply = async (currentOnly: boolean) => {
    if (!draft) return
    if (currentOnly && !sessionId) { setError('当前没有活动会话，无法仅应用到此对话'); return }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      if (currentOnly) {
        await postJson('/api/model-settings/apply-current', { sessionId, ...clean(draft.main) })
        setNotice('已应用到当前对话，刷新后仍生效')
      } else {
        const payload = await postJson('/api/model-settings/save', {
          main: clean(draft.main),
          subagent: draft.subagent.enabled ? clean(draft.subagent) : null,
          goal: draft.goal.enabled ? clean(draft.goal) : null,
          ...(sessionId ? { sessionId } : {}),
        })
        setState(payload)
        setDraft(draftFromState(payload))
        setNotice('已保存，新的路由立即生效')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const mainValid = draft != null && draft.main.provider !== '' && draft.main.model !== ''
  const slotValid = (s: SlottedSelection) => !s.enabled || (s.provider !== '' && s.model !== '')
  const formValid = mainValid && (draft == null || (slotValid(draft.subagent) && slotValid(draft.goal)))

  return (
    <div className="yenra-model-routes">
      <p className="yenra-mr-intro">
        统一控制主模型、子代理与 goal 回合的模型和推理强度，保存即热更新，无需重启。
      </p>
      {loading ? <p className="yenra-mr-status" role="status">正在读取模型路由…</p> : null}
      {error ? <p className="yenra-mr-status" role="alert" data-kind="error">{error}</p> : null}
      {notice ? <p className="yenra-mr-status" role="status" data-kind="ok">{notice}</p> : null}

      {draft && (
        <>
          <RouteCard
            title="主模型"
            hint="新会话与主对话的默认路由"
            slot={draft.main}
            canToggle={false}
            enabled
            groups={groups}
            onChange={next => setDraft({ ...draft, main: next })}
          />
          <RouteCard
            title="子代理"
            hint="subagent 与 workflow 拉起的子任务"
            slot={draft.subagent}
            canToggle
            enabled={draft.subagent.enabled}
            groups={groups}
            onToggle={on => setDraft({ ...draft, subagent: { ...draft.subagent, enabled: on } })}
            onChange={next => setDraft({ ...draft, subagent: { ...draft.subagent, ...next } })}
          />
          <RouteCard
            title="Goal 回合"
            hint="goal 激活期间的会话回合"
            slot={draft.goal}
            canToggle
            enabled={draft.goal.enabled}
            groups={groups}
            onToggle={on => setDraft({ ...draft, goal: { ...draft.goal, enabled: on } })}
            onChange={next => setDraft({ ...draft, goal: { ...draft.goal, ...next } })}
          />
        </>
      )}

      {!loading && !draft && !error ? (
        <p className="yenra-mr-status" role="status">没有可配置的模型提供方。</p>
      ) : null}

      <footer className="yenra-mr-actions">
        <button type="button" className="yenra-mr-btn" data-primary disabled={!formValid || saving}
          onClick={() => void apply(false)}>
          {saving ? '保存中…' : '应用到全局'}
        </button>
        <button type="button" className="yenra-mr-btn" disabled={!mainValid || saving || !sessionId}
          onClick={() => void apply(true)}>
          仅应用到当前对话
        </button>
      </footer>
      <p className="yenra-mr-footnote">
        应用到全局：写入配置并立即切换当前对话；仅应用到当前对话：不写配置，刷新仍保留。子代理与 goal 档只随“应用到全局”生效。
      </p>
    </div>
  )
}
