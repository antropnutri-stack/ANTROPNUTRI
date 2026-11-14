import { Link } from 'react-router-dom'
import { useConfig } from '../../lib/hooks'
import { STATIONS, VARIABLES, pad } from '../../lib/types'
import { Bar, Stat } from '../../components/ui'
import { useOperations } from './data'

export default function Dashboard() {
  const { data: cfg } = useConfig()
  const { data } = useOperations()
  if (!cfg || !data) return <p className="muted">Cargando…</p>

  const evaluators = cfg.profiles.filter((p) => p.role === 'evaluador' && p.status === 'activa')
  const authorizers = cfg.profiles.filter((p) => p.status === 'activa' && (p.role === 'principal' || (p.role === 'admin' && p.can_resolve_requests)))
  const complete = data.results.filter((r) => r.estado === 'completo').length
  const review = data.results.filter((r) => r.estado === 'requiere_revision').length
  const pendingReq = data.requests.filter((r) => r.status === 'pendiente').length
  const has = new Set(data.measurements.map((m) => m.participant_id + m.variable))

  // Actividad reciente: mediciones de los últimos 15 minutos por evaluador
  const since = Date.now() - 15 * 60000
  const recent = new Map<string, number>()
  const total = new Map<string, number>()
  for (const m of data.measurements) {
    total.set(m.evaluator_id, (total.get(m.evaluator_id) ?? 0) + 1)
    if (new Date(m.created_at).getTime() > since) recent.set(m.evaluator_id, (recent.get(m.evaluator_id) ?? 0) + 1)
  }
  const ratePerHour = data.measurements.filter((m) => new Date(m.created_at).getTime() > since).length * 4

  return (
    <>
      <h1>Panel general</h1>
      <p className="muted">{cfg.campaign ? `${cfg.campaign.name} · ${cfg.campaign.event_date}` : 'No hay campaña activa (configúrela en Configuración).'}</p>
      <div className="stats">
        <Stat label="Participantes" value={data.results.length} />
        <Stat label="Completos" value={complete} />
        <Stat label="Requieren revisión" value={review} />
        <Stat label="Evaluadores activos" value={evaluators.length} />
        <Stat label="Grupos" value={cfg.groups.length} />
        <Stat label="Autorizadores" value={authorizers.length} />
      </div>
      {pendingReq > 0 && <div className="alert warn"><strong>{pendingReq} solicitud(es) de apoyo pendiente(s).</strong> <Link to="/solicitudes">Revisar</Link></div>}

      <div className="grid cols-2">
        <div className="card">
          <h2>Avance por grupo</h2>
          {cfg.groups.map((g) => {
            const ps = data.results.filter((r) => r.group_id === g.id)
            const done = ps.filter((r) => r.estado === 'completo').length
            const meas = ps.reduce((a, r) => a + r.n_measurements, 0)
            return (
              <div key={g.id}>
                <div className="bar-row"><span>Grupo {g.code}</span><Bar value={meas} total={ps.length * 5} />
                  <span className="pct">{ps.length ? Math.round((meas / (ps.length * 5)) * 100) : 0}%</span></div>
                <small className="muted">{done}/{ps.length} completos · rango {pad(g.range_start)}–{pad(g.range_end)}</small>
              </div>
            )
          })}
          <p className="muted" style={{ marginTop: '.8rem', fontSize: '.85rem' }}>Ritmo actual: ~{ratePerHour} mediciones/hora (últimos 15 min).</p>
        </div>

        <div className="card">
          <h2>Avance por estación</h2>
          {cfg.groups.filter((g) => data.results.some((r) => r.group_id === g.id)).map((g) => {
            const ps = data.results.filter((r) => r.group_id === g.id)
            return (
              <div key={g.id} style={{ marginBottom: '.6rem' }}>
                <strong>Grupo {g.code}</strong>
                {VARIABLES.map((v) => {
                  const n = ps.filter((p) => has.has(p.id + v.key)).length
                  return <div className="bar-row" key={v.key}><span className="muted">{v.short}</span><Bar value={n} total={ps.length} /><span className="pct">{n}/{ps.length}</span></div>
                })}
              </div>
            )
          })}
          <small className="muted">La estación con menor avance en un grupo indica un posible cuello de botella.</small>
        </div>
      </div>

      <div className="card">
        <h2>Evaluadores</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Código</th><th>Nombre</th><th>Grupo</th><th>Estación</th><th className="num">Registros</th><th className="num">Últimos 15 min</th></tr></thead>
          <tbody>{evaluators.map((p) => (
            <tr key={p.id}><td>{p.code}</td><td>{p.display_name}</td><td>{cfg.groups.find((g) => g.id === p.group_id)?.code ?? '—'}</td>
              <td>{STATIONS.find((s) => s.key === p.station)?.label ?? '—'}</td>
              <td className="num">{total.get(p.id) ?? 0}</td><td className="num">{recent.get(p.id) ?? 0}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  )
}
