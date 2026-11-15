import { useState } from 'react'
import { useConfig, useLive, q } from '../../lib/hooks'
import { supabase } from '../../lib/supabase'
import type { AuditEntry } from '../../lib/types'

const ACTION_LABEL: Record<string, string> = {
  medicion_registrada: 'Medición registrada', medicion_corregida: 'Medición corregida', medicion_repetida: 'Medición repetida (autorizada)', medicion_anulada: 'Medición anulada',
  participante_registrado: 'Participante registrado', participantes_importados: 'Importación Excel', participante_corregido: 'Participante corregido',
  cambio_grupo: 'Cambio de grupo', solicitud_creada: 'Solicitud creada', solicitud_aprobada: 'Solicitud aprobada',
  solicitud_rechazada: 'Solicitud rechazada', solicitud_cancelada: 'Solicitud cancelada', cuenta_creada: 'Cuenta creada',
  cuenta_modificada: 'Cuenta modificada', 'contraseña_restablecida': 'Contraseña restablecida', rango_modificado: 'Rango modificado',
  marcado_revision: 'Marcado para revisión', revision_resuelta: 'Revisión resuelta',
}

export default function Audit() {
  const { data: cfg } = useConfig()
  const [action, setAction] = useState('')
  const [hideRoutine, setHideRoutine] = useState(true)
  const { data } = useLive(async () => {
    let query = supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(500)
    if (action) query = query.eq('action', action)
    else if (hideRoutine) query = query.neq('action', 'medicion_registrada')
    return q<AuditEntry[]>(query)
  }, [], [action, hideRoutine])
  const who = (id: string | null) => cfg?.profiles.find((p) => p.id === id)?.display_name ?? '—'

  return (
    <>
      <div className="row"><h1 className="grow">Auditoría</h1>
        <label className="check"><input type="checkbox" checked={hideRoutine} onChange={(e) => setHideRoutine(e.target.checked)} />Ocultar registros rutinarios</label>
        <select style={{ width: 'auto' }} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Todas las acciones</option>{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div className="card table-wrap" style={{ padding: 0, maxHeight: '75vh' }}>
        <table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
          <tbody>{data?.map((a) => (
            <tr key={a.id}><td>{new Date(a.created_at).toLocaleString('es-PE')}</td><td>{who(a.actor_id)}</td>
              <td>{ACTION_LABEL[a.action] ?? a.action}</td>
              <td style={{ whiteSpace: 'normal', fontSize: '.8rem', fontFamily: 'monospace' }}>{JSON.stringify(a.details)}</td></tr>))}</tbody></table>
      </div>
      <p className="muted" style={{ fontSize: '.85rem' }}>Se muestran los últimos 500 eventos. La exportación a Excel incluye el historial completo.</p>
    </>
  )
}
