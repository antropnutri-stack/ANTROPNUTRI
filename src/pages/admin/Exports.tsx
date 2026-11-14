import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { fetchAll, useConfig } from '../../lib/hooks'
import { exportWorkbook } from '../../lib/excel'
import { errorMessage } from '../../lib/supabase'
import type { AuditEntry } from '../../lib/types'
import { useOperations } from './data'

export default function Exports() {
  const { data: cfg } = useConfig()
  const { data } = useOperations()
  const { can } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!cfg || !data) return <p className="muted">Cargando…</p>

  async function run() {
    setBusy(true); setErr('')
    try {
      const audit = can('can_view_audit') ? await fetchAll<AuditEntry>('audit_log', 'id') : null
      const ids = new Set(data!.results.map((r) => r.id))
      await exportWorkbook({
        campaignName: cfg!.campaign?.name ?? 'campaña', results: data!.results,
        measurements: data!.measurements.filter((m) => ids.has(m.participant_id)), profiles: cfg!.profiles, groups: cfg!.groups,
        requests: data!.requests.filter((r) => ids.has(r.participant_id)), audit,
      })
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  const complete = data.results.filter((r) => r.estado === 'completo').length
  return (
    <div className="narrow">
      <h1>Exportar a Excel</h1>
      <div className="card">
        <p>Se generará un archivo <code>.xlsx</code> con las hojas:</p>
        <ul>
          <li><strong>Resultados</strong>: una fila por participante con las cinco mediciones, IMC y clasificación, relación cintura/talla, CMB estimada, estado y evaluador de cada medición.</li>
          <li><strong>Pendientes</strong>: participantes incompletos y mediciones faltantes.</li>
          <li><strong>Mediciones</strong>: detalle con responsable y hora.</li>
          <li><strong>Solicitudes</strong>: apoyos y traslados con su resolución.</li>
          {can('can_view_audit') && <li><strong>Auditoría</strong>: historial de correcciones y autorizaciones.</li>}
          <li><strong>Resumen</strong>: estadísticas descriptivas.</li>
        </ul>
        <p className="muted">{data.results.length} participantes · {complete} completos.</p>
        {err && <div className="alert err">{err}</div>}
        <button className="primary big" disabled={busy} onClick={() => void run()}>{busy ? 'Generando…' : 'Descargar Excel'}</button>
        <p className="muted" style={{ marginTop: '.8rem', fontSize: '.85rem' }}>El archivo contiene datos personales y de salud: guárdelo en un lugar protegido y no lo comparta por canales abiertos.</p>
      </div>
    </div>
  )
}
