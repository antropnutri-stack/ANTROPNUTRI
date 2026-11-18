import { useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { fetchAll, useConfig, useLive, useQueue } from '../lib/hooks'
import { discardOp, retryOp } from '../lib/offlineQueue'
import { normName } from '../lib/calc'
import { N_VARS, REQUEST_TYPE_LABEL, VARIABLES, pad, varLabel,
  type Measurement, type Participant, type SupportRequest } from '../lib/types'
import { MeasureForm, cacheParticipants } from '../components/MeasureForm'
import { RegisterParticipant } from '../components/RegisterParticipant'
import { Bar, Modal, Stat, StatusBadge, useToast } from '../components/ui'

export default function EvaluatorHome() {
  const { profile } = useAuth()
  const { data: cfg } = useConfig()
  const [openNumber, setOpenNumber] = useState<number | null>(null)
  const [registering, setRegistering] = useState(false)
  const queue = useQueue()
  const toast = useToast()

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
  const campaignId = cfg.campaign?.id
  const groupCode = (id: string) => cfg.groups.find((g) => g.id === id)?.code ?? '?'
  const participants = data?.participants.filter((p) => p.campaign_id === campaignId) ?? []
  const ids = new Set(participants.map((p) => p.id))
  const measurements = data?.measurements.filter((m) => ids.has(m.participant_id)) ?? []
  const mine = measurements.filter((m) => m.evaluator_id === profile.id).length
  const complete = participants.filter((p) => measurements.filter((m) => m.participant_id === p.id).length >= N_VARS).length

  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      {toast.node}
      <h1>Bienvenido, {profile.display_name}</h1>
      <p className="muted">Puede registrar cualquiera de las {N_VARS} mediciones de cualquier participante.</p>

      <div className="stats">
        <Stat label="Mis registros" value={mine} />
        <Stat label="Participantes" value={participants.length} />
        <Stat label="Completos" value={complete} />
      </div>
      <div style={{ marginBottom: '1rem' }}><Bar value={measurements.length} total={participants.length * N_VARS} /></div>

      <QueuePanel queue={queue} />

      <MeasureForm campaignId={campaignId ?? ''} variables={VARIABLES.map((v) => v.key)} ranges={cfg.ranges} profiles={cfg.profiles}
        groupCode={groupCode} openNumber={openNumber} onOpened={() => setOpenNumber(null)} />

      <div className="row" style={{ marginBottom: '1rem' }}>
        <button className="big" onClick={() => setRegistering(true)}>+ Registrar participante</button>
      </div>

      {data && <ParticipantsTable participants={participants} measurements={measurements} groupCode={groupCode}
        onPick={(n) => { setOpenNumber(n); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />}

      <MyRequests requests={data?.requests.filter((r) => r.requested_by === profile.id) ?? []} participants={participants} />

      {registering && (
        <Modal title="Registrar participante" onClose={() => setRegistering(false)}>
          <RegisterParticipant groups={cfg.groups} />
        </Modal>
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

function ParticipantsTable({ participants, measurements, groupCode, onPick }: {
  participants: Participant[]; measurements: Measurement[]; groupCode: (id: string) => string; onPick: (n: number) => void
}) {
  const [filter, setFilter] = useState<'pendientes' | 'todos'>('pendientes')
  const [q, setQ] = useState('')
  const by = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const x of measurements) { if (!m.has(x.participant_id)) m.set(x.participant_id, new Set()); m.get(x.participant_id)!.add(x.variable) }
    return m
  }, [measurements])
  const rows = participants.map((p) => {
    const n = by.get(p.id)?.size ?? 0
    return { p, n, estado: p.needs_review ? 'requiere_revision' : n === 0 ? 'sin_iniciar' : n < N_VARS ? 'en_proceso' : 'completo' }
  }).filter((r) => (filter === 'todos' || r.estado !== 'completo') &&
    (!q || pad(r.p.number).includes(q) || (r.p.dni ?? '').includes(q) || normName(r.p.full_name).includes(normName(q))))

  return (
    <div className="card">
      <div className="row"><h2 className="grow">Participantes</h2><small className="muted">Toque uno para registrar sus medidas</small>
        <select style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as 'todos')}>
          <option value="pendientes">Pendientes</option><option value="todos">Todos</option>
        </select></div>
      <input placeholder="Buscar por número, DNI o nombre" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: '.5rem 0' }} />
      <div className="table-wrap" style={{ maxHeight: '60vh' }}><table>
        <thead><tr><th>N.º</th><th>Nombre</th><th>Promoción</th>{VARIABLES.map((v) => <th key={v.key} title={v.label}>{v.short}</th>)}<th>Estado</th></tr></thead>
        <tbody>{rows.map(({ p, estado }) => (
          <tr key={p.id} className="clickable" onClick={() => onPick(p.number)}><td><strong>{pad(p.number)}</strong></td><td>{p.full_name}</td><td>{groupCode(p.group_id)}</td>
            {VARIABLES.map((v) => <td key={v.key}>{by.get(p.id)?.has(v.key) ? '✓' : '·'}</td>)}
            <td><StatusBadge estado={estado} /></td>
          </tr>))}
          {!rows.length && <tr><td colSpan={N_VARS + 4} className="muted">Sin participantes {filter === 'pendientes' ? 'pendientes' : ''}.</td></tr>}
        </tbody>
      </table></div>
    </div>
  )
}

function MyRequests({ requests, participants }: { requests: SupportRequest[]; participants: Participant[] }) {
  if (!requests.length) return null
  return (
    <div className="card"><h2>Mis solicitudes</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>N.º</th><th>Tipo</th><th>Mediciones</th><th>Estado</th><th>Nota</th></tr></thead>
        <tbody>{[...requests].reverse().map((r) => {
          const p = participants.find((x) => x.id === r.participant_id)
          return <tr key={r.id}><td>{p ? pad(p.number) : '—'}</td><td>{REQUEST_TYPE_LABEL[r.type]}</td>
            <td>{r.variables.map((v) => VARIABLES.find((x) => x.key === v)?.short).join(', ')}</td>
            <td><StatusBadge estado={r.status} /></td><td>{r.resolution_note ?? ''}</td></tr>
        })}</tbody>
      </table></div>
    </div>
  )
}
