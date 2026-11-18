import { useConfig } from '../../lib/hooks'
import { VARIABLES, pad, varLabel } from '../../lib/types'
import { StatusBadge } from '../../components/ui'
import { useOperations } from './data'

export default function Quality() {
  const { data: cfg } = useConfig()
  const { data } = useOperations()
  if (!cfg || !data) return <p className="muted">Cargando…</p>
  const num = new Map(data.results.map((r) => [r.id, r]))
  const who = (id: string) => cfg.profiles.find((p) => p.id === id)?.display_name ?? '—'
  const unusual = data.measurements.filter((m) => m.is_unusual)
  const corrected = data.measurements.filter((m) => m.updated_at !== m.created_at)
  const review = data.results.filter((r) => r.needs_review)
  // Coherencia entre variables: CMB no positiva o RCT extrema suelen indicar error de unidad
  const incoherent = data.results.filter((r) => (r.cmb != null && r.cmb <= 10) || (r.rct != null && (r.rct < 0.3 || r.rct > 0.9)) || (r.imc != null && (r.imc < 13 || r.imc > 55)))

  return (
    <>
      <h1>Control de calidad</h1>
      <div className="grid cols-2">
        <div className="card"><h2>Requieren revisión ({review.length})</h2>
          {review.length === 0 ? <p className="muted">Ninguno.</p> : <table><tbody>{review.map((r) => (
            <tr key={r.id}><td><strong>{pad(r.number)}</strong></td><td>{r.group_code}</td><td>{r.review_note}</td></tr>))}</tbody></table>}
        </div>
        <div className="card"><h2>Indicadores incoherentes ({incoherent.length})</h2>
          <p className="muted" style={{ fontSize: '.85rem' }}>IMC &lt; 13 o &gt; 55, RCT &lt; 0.3 o &gt; 0.9, CMB ≤ 10 cm: suele indicar un error de unidad o de digitación.</p>
          {incoherent.length === 0 ? <p className="muted">Ninguno.</p> : <table><tbody>{incoherent.map((r) => (
            <tr key={r.id}><td><strong>{pad(r.number)}</strong></td><td>IMC {r.imc ?? '—'}</td><td>RCT {r.rct ?? '—'}</td><td>CMB {r.cmb ?? '—'}</td></tr>))}</tbody></table>}
        </div>
      </div>
      <div className="card"><h2>Valores inusuales confirmados ({unusual.length})</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>N.º</th><th>Variable</th><th className="num">Valor</th><th>Evaluador</th><th>Hora</th><th>Estado</th></tr></thead>
          <tbody>{unusual.map((m) => {
            const r = num.get(m.participant_id)
            const unit = VARIABLES.find((v) => v.key === m.variable)!.unit
            return <tr key={m.id}><td>{r ? pad(r.number) : '—'}</td><td>{varLabel(m.variable)}</td><td className="num">{Number(m.value)} {unit}</td>
              <td>{who(m.evaluator_id)}</td><td>{new Date(m.created_at).toLocaleTimeString('es-PE')}</td><td>{r && <StatusBadge estado={r.estado} />}</td></tr>
          })}</tbody>
        </table></div>
      </div>
      <div className="card"><h2>Mediciones corregidas ({corrected.length})</h2>
        <p className="muted">El detalle (valor anterior, motivo y responsable) está en Auditoría.</p>
      </div>
    </>
  )
}
