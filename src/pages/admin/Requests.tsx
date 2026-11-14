import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useConfig } from '../../lib/hooks'
import { supabase, errorMessage } from '../../lib/supabase'
import { REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, pad, varLabel, type RequestStatus } from '../../lib/types'
import { StatusBadge, useToast } from '../../components/ui'
import { useOperations } from './data'

export default function Requests() {
  const { data: cfg } = useConfig()
  const { data, refresh } = useOperations()
  const { can } = useAuth()
  const toast = useToast()
  const [filter, setFilter] = useState<RequestStatus | ''>('pendiente')
  const [busy, setBusy] = useState<string | null>(null)
  if (!cfg || !data) return <p className="muted">Cargando…</p>

  const who = (id: string | null) => cfg.profiles.find((p) => p.id === id)?.display_name ?? '—'
  const grp = (id: string) => cfg.groups.find((g) => g.id === id)?.code ?? '?'
  const num = (id: string) => data.results.find((r) => r.id === id)?.number
  const list = [...data.requests].reverse().filter((r) => !filter || r.status === filter)
  const canResolve = can('can_resolve_requests')

  async function resolve(id: string, approve: boolean) {
    const note = approve ? null : prompt('Motivo del rechazo (opcional):')
    setBusy(id)
    const { data: res, error } = await supabase.rpc('resolve_support_request', { p_id: id, p_approve: approve, p_note: note })
    setBusy(null)
    if (error) return toast.show('err', errorMessage(error))
    if (res.status === 'ya_resuelta') toast.show('warn', `Ya fue resuelta por ${who(res.resolved_by)} (${REQUEST_STATUS_LABEL[res.current as RequestStatus]}).`)
    else toast.show('ok', approve ? 'Solicitud aprobada.' : 'Solicitud rechazada.')
    refresh()
  }
  async function cancel(id: string) {
    const note = prompt('Motivo de la cancelación:'); if (note === null) return
    const { error } = await supabase.rpc('cancel_support_request', { p_id: id, p_note: note })
    if (error) toast.show('err', errorMessage(error)); else refresh()
  }

  return (
    <>
      {toast.node}
      <div className="row"><h1 className="grow">Solicitudes de apoyo y traslado</h1>
        <select style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as RequestStatus)}>
          <option value="">Todas</option>{Object.entries(REQUEST_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
      {!canResolve && <div className="alert info">Su cuenta no está habilitada como autorizadora; solo puede consultar.</div>}
      {list.length === 0 && <div className="card muted">No hay solicitudes {filter ? REQUEST_STATUS_LABEL[filter].toLowerCase() + 's' : ''}.</div>}
      {list.map((r) => (
        <div className="card" key={r.id}>
          <div className="row">
            <strong className="grow" style={{ fontSize: '1.1rem' }}>Participante {num(r.participant_id) ? pad(num(r.participant_id)!) : '—'} · {REQUEST_TYPE_LABEL[r.type]}</strong>
            <StatusBadge estado={r.status} />
          </div>
          <p style={{ margin: '.4rem 0' }}>Grupo {grp(r.origin_group_id)} → Grupo {grp(r.target_group_id)}
            {r.variables.length > 0 && <> · {r.variables.map(varLabel).join(', ')}</>}</p>
          <p className="muted" style={{ margin: 0 }}>Motivo: {r.reason}</p>
          <small className="muted">Solicitó {who(r.requested_by)} · {new Date(r.created_at).toLocaleTimeString('es-PE')}
            {r.resolved_by && <> · Resolvió {who(r.resolved_by)} {r.resolved_at && new Date(r.resolved_at).toLocaleTimeString('es-PE')}</>}
            {r.resolution_note && <> · Nota: {r.resolution_note}</>}</small>
          {canResolve && (r.status === 'pendiente' || r.status === 'aprobada') && (
            <div className="row" style={{ marginTop: '.6rem' }}>
              {r.status === 'pendiente' && <>
                <button className="ok" disabled={busy === r.id} onClick={() => void resolve(r.id, true)}>Aprobar</button>
                <button className="danger" disabled={busy === r.id} onClick={() => void resolve(r.id, false)}>Rechazar</button>
              </>}
              <button onClick={() => void cancel(r.id)}>Cancelar</button>
            </div>
          )}
        </div>
      ))}
    </>
  )
}
