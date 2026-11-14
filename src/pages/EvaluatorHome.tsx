import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { fetchAll, useConfig, useLive, useQueue } from '../lib/hooks'
import { discardOp, retryOp } from '../lib/offlineQueue'
import { supabase, errorMessage } from '../lib/supabase'
import { REQUEST_TYPE_LABEL, STATUS_LABEL, VARIABLES, pad, stationOf, varLabel,
  type Measurement, type Participant, type ParticipantResult, type SupportRequest } from '../lib/types'
import { MeasureForm, cacheParticipants } from '../components/MeasureForm'
import { RegisterParticipant } from '../components/RegisterParticipant'
import { SupportRequestForm } from '../components/SupportRequestForm'
import { Bar, Stat, StatusBadge, useToast } from '../components/ui'

export default function EvaluatorHome() {
  const { profile } = useAuth()
  const { data: cfg } = useConfig()
  const [support, setSupport] = useState<{ number?: number } | null>(null)
  const queue = useQueue()
  const toast = useToast()
  const st = stationOf(profile!.station)

  const { data } = useLive(async () => {
    const [participants, measurements, requests] = await Promise.all([
      fetchAll<Participant>('participants', 'number'),
      fetchAll<Measurement>('measurements'),
      fetchAll<SupportRequest>('support_requests', 'created_at'),
    ])
    cacheParticipants(participants)
    return { participants, measurements, requests }
  }, ['participants', 'measurements', 'support_requests'])

  if (!cfg || !profile) return <p className="muted">Cargando…</p>
  const group = cfg.groups.find((g) => g.id === profile.group_id)
  const groupCode = (id: string) => cfg.groups.find((g) => g.id === id)?.code ?? '?'
  const mine = data?.measurements.filter((m) => m.evaluator_id === profile.id).length ?? 0
  const own = data?.participants.filter((p) => p.group_id === profile.group_id) ?? []
  const vars = st?.variables ?? []
  const has = new Set(data?.measurements.map((m) => m.participant_id + m.variable))
  const doneP = own.filter((p) => vars.length ? vars.every((v) => has.has(p.id + v)) : true).length
  const pendingP = own.length - doneP
  const supportIn = data?.requests.filter((r) => r.status === 'aprobada' && r.target_group_id === profile.group_id) ?? []

  return (
    <div className="narrow" style={{ maxWidth: 720 }}>
      {toast.node}
      <p className="muted" style={{ marginBottom: '.2rem' }}>ANTROPNUTRI · Grupo {group?.code ?? '—'}</p>
      <h1>Bienvenido, {profile.display_name}</h1>
      <p className="muted">Estación: <strong>{st?.label ?? 'Sin asignar'}</strong></p>

      {!group || !st ? (
        <div className="alert warn">Su cuenta aún no tiene grupo o estación asignados. Comuníquese con la administración.</div>
      ) : (
        <>
          <div className="stats">
            <Stat label="Mis registros" value={profile.station === 'registro' ? own.filter((p) => p.created_by === profile.id).length : mine} />
            <Stat label={profile.station === 'registro' ? 'Registrados en el grupo' : 'Pendientes del grupo'} value={profile.station === 'registro' ? own.length : pendingP} />
            {vars.length > 0 && <Stat label="Progreso de la estación" value={`${own.length ? Math.round((doneP / own.length) * 100) : 0}%`} />}
          </div>
          {vars.length > 0 && <div style={{ marginBottom: '1rem' }}><Bar value={doneP} total={own.length} /></div>}

          <QueuePanel queue={queue} />

          {supportIn.length > 0 && (
            <div className="alert info">Apoyo autorizado para su grupo: {supportIn.map((r) => {
              const p = data!.participants.find((x) => x.id === r.participant_id)
              return `${p ? pad(p.number) : '?'} (${r.variables.map((v) => VARIABLES.find((x) => x.key === v)!.short).join(', ')})`
            }).join(' · ')}</div>
          )}

          {profile.station === 'registro' ? (
            <div className="card"><h2>Registro de participante</h2>
              <RegisterParticipant groups={cfg.groups} defaultGroupId={profile.group_id} chooseGroup={false} />
            </div>
          ) : (
            <MeasureForm campaignId={cfg.campaign?.id ?? ''} variables={vars} ranges={cfg.ranges} profiles={cfg.profiles} groupCode={groupCode}
              onRequestSupport={(n) => setSupport({ number: n })} />
          )}

          <div className="row" style={{ marginBottom: '1rem' }}>
            <button className="big" onClick={() => setSupport({})}>Solicitar apoyo</button>
          </div>

          {(profile.station === 'supervision' || profile.station === 'registro') && data && (
            <GroupTable participants={own} measurements={data.measurements} supervisor={profile.station === 'supervision'} onToast={toast.show} />
          )}

          <MyRequests requests={data?.requests.filter((r) => r.requested_by === profile.id) ?? []}
            participants={data?.participants ?? []} groupCode={groupCode} />
        </>
      )}

      {support && (
        <SupportRequestForm groups={cfg.groups} ownGroupId={profile.group_id} initialNumber={support.number}
          onClose={() => setSupport(null)}
          onDone={() => { setSupport(null); toast.show('ok', 'Solicitud enviada a los administradores autorizadores.') }} />
      )}
    </div>
  )
}

function QueuePanel({ queue }: { queue: ReturnType<typeof useQueue> }) {
  const errs = queue.filter((o) => o.state === 'error')
  const pend = queue.filter((o) => o.state === 'pendiente')
  if (!queue.length) return null
  return (
    <div className="card">
      <h3>Sincronización</h3>
      {pend.length > 0 && <div className="alert warn">{pend.length} medición(es) guardadas en este dispositivo, pendientes de enviar. No cierre la sesión ni borre los datos del navegador.</div>}
      {errs.map((o) => (
        <div key={o.id} className="alert err">
          <strong>{pad(o.number)} · {varLabel(o.variable)}: {o.value}</strong><br />{o.error}
          <div className="row" style={{ marginTop: '.4rem' }}>
            <button onClick={() => retryOp(o.id)}>Reintentar</button>
            <button onClick={() => confirm('¿Descartar este registro local? No se enviará al servidor.') && discardOp(o.id)}>Descartar</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function GroupTable({ participants, measurements, supervisor, onToast }: {
  participants: Participant[]; measurements: Measurement[]; supervisor: boolean
  onToast: (k: 'ok' | 'err', t: string) => void
}) {
  const [filter, setFilter] = useState<'todos' | 'pendientes'>('pendientes')
  const by = new Map<string, Set<string>>()
  for (const m of measurements) { if (!by.has(m.participant_id)) by.set(m.participant_id, new Set()); by.get(m.participant_id)!.add(m.variable) }
  const rows = participants.map((p) => {
    const n = by.get(p.id)?.size ?? 0
    const estado: ParticipantResult['estado'] = p.needs_review ? 'requiere_revision' : n === 0 ? 'sin_iniciar' : n < 5 ? 'en_proceso' : 'completo'
    return { p, n, estado }
  }).filter((r) => filter === 'todos' || r.estado !== 'completo')

  async function toggleReview(p: Participant) {
    const note = p.needs_review ? null : prompt('Motivo de la revisión:')
    if (!p.needs_review && !note) return
    const { error } = await supabase.rpc('set_review', { p_id: p.id, p_needs_review: !p.needs_review, p_note: note })
    if (error) onToast('err', errorMessage(error))
  }

  return (
    <div className="card">
      <div className="row"><h2 className="grow">Participantes del grupo</h2>
        <select style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as 'todos')}>
          <option value="pendientes">Pendientes</option><option value="todos">Todos</option>
        </select></div>
      <div className="table-wrap"><table>
        <thead><tr><th>N.º</th><th>Nombre</th>{VARIABLES.map((v) => <th key={v.key}>{v.short}</th>)}<th>Estado</th>{supervisor && <th />}</tr></thead>
        <tbody>{rows.map(({ p, estado }) => (
          <tr key={p.id}><td><strong>{pad(p.number)}</strong></td><td>{p.full_name}</td>
            {VARIABLES.map((v) => <td key={v.key}>{by.get(p.id)?.has(v.key) ? '✓' : '·'}</td>)}
            <td><StatusBadge estado={estado} /></td>
            {supervisor && <td><button onClick={() => void toggleReview(p)}>{p.needs_review ? 'Quitar revisión' : 'Marcar revisión'}</button></td>}
          </tr>))}
          {!rows.length && <tr><td colSpan={9} className="muted">Sin participantes {filter === 'pendientes' ? 'pendientes' : ''}.</td></tr>}
        </tbody>
      </table></div>
      <small>{STATUS_LABEL.completo}: las cinco mediciones guardadas.</small>
    </div>
  )
}

function MyRequests({ requests, participants, groupCode }: { requests: SupportRequest[]; participants: Participant[]; groupCode: (id: string) => string }) {
  if (!requests.length) return null
  return (
    <div className="card"><h2>Mis solicitudes</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>N.º</th><th>Tipo</th><th>Destino</th><th>Estado</th><th>Nota</th></tr></thead>
        <tbody>{[...requests].reverse().map((r) => {
          const p = participants.find((x) => x.id === r.participant_id)
          return <tr key={r.id}><td>{p ? pad(p.number) : '—'}</td><td>{REQUEST_TYPE_LABEL[r.type]}</td><td>Grupo {groupCode(r.target_group_id)}</td>
            <td><StatusBadge estado={r.status} /></td><td>{r.resolution_note ?? ''}</td></tr>
        })}</tbody>
      </table></div>
    </div>
  )
}
