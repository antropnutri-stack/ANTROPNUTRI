import { useState } from 'react'
import { fetchAll, useConfig } from '../../lib/hooks'
import { supabase, errorMessage } from '../../lib/supabase'
import { downloadTemplate, parseParticipantsFile, type ImportRow } from '../../lib/excel'
import type { Participant } from '../../lib/types'

export default function ImportParticipants() {
  const { data: cfg } = useConfig()
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ row: number; error: string }[]>([])
  if (!cfg) return <p className="muted">Cargando…</p>

  async function onFile(file: File) {
    setMsg(null); setErrors([]); setBusy(true)
    try {
      const existing = (await fetchAll<Participant>('participants', 'number')).filter((p) => p.campaign_id === cfg!.campaign?.id)
      setRows(await parseParticipantsFile(file, existing, cfg!.groups))
    } catch (e) { setMsg({ kind: 'err', text: errorMessage(e) }); setRows(null) } finally { setBusy(false) }
  }

  async function confirmImport() {
    const sel = rows!.filter((r) => r.include)
    if (!sel.length) return
    setBusy(true)
    const payload = sel.map((r) => ({ full_name: r.full_name, sex: r.sex, birth_date: r.birth_date, age: r.age, group_code: r.group_code, number: r.number }))
    const { data, error } = await supabase.rpc('import_participants', { p_rows: payload })
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: errorMessage(error) })
    setErrors((data.errors as { row: number; error: string }[]).map((e) => ({ ...e, row: sel[e.row - 1].row })))
    setMsg({ kind: data.errors.length ? 'warn' : 'ok', text: `Importados ${data.inserted} participantes${data.errors.length ? `; ${data.errors.length} con error` : ''}.` })
    setRows(null)
  }

  const included = rows?.filter((r) => r.include).length ?? 0
  return (
    <>
      <h1>Importar participantes desde Excel</h1>
      <div className="card">
        <p>Columnas reconocidas: <strong>Nombres y apellidos</strong> (obligatoria), Sexo (F/M), Fecha de nacimiento (aaaa-mm-dd o dd/mm/aaaa), Edad, Grupo (A–E) y Número. Si no indica grupo ni número, se asignan automáticamente según los rangos de cada grupo.</p>
        <div className="row">
          <input type="file" accept=".xlsx" style={{ width: 'auto' }} onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          <button onClick={() => void downloadTemplate()}>Descargar plantilla</button>
        </div>
      </div>
      {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}
      {errors.length > 0 && <div className="card"><h3>Filas no importadas</h3><ul>{errors.map((e) => <li key={e.row}>Fila {e.row}: {e.error}</li>)}</ul></div>}
      {busy && <p className="muted">Procesando…</p>}
      {rows && (
        <div className="card">
          <div className="row"><h2 className="grow">Revisión previa ({rows.length} filas)</h2>
            <span className="muted">{included} seleccionadas</span>
            <button className="primary" disabled={!included || busy} onClick={() => void confirmImport()}>Confirmar importación</button>
            <button onClick={() => setRows(null)}>Cancelar</button></div>
          <div className="table-wrap" style={{ maxHeight: '60vh' }}><table>
            <thead><tr><th /><th>Fila</th><th>Nombre</th><th>Sexo</th><th>Nacimiento</th><th>Edad</th><th>Grupo</th><th>N.º</th><th>Observaciones</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.row} style={{ background: r.issues.length ? 'var(--err-bg)' : r.duplicateOf ? 'var(--warn-bg)' : undefined }}>
                <td><input type="checkbox" checked={r.include} disabled={r.issues.length > 0}
                  onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))} /></td>
                <td>{r.row}</td><td>{r.full_name}</td><td>{r.sex}</td><td>{r.birth_date}</td><td>{r.age}</td><td>{r.group_code || 'auto'}</td><td>{r.number || 'auto'}</td>
                <td>{[...r.issues, r.duplicateOf ? `Posible duplicado: ${r.duplicateOf}` : ''].filter(Boolean).join(' · ')}</td>
              </tr>))}</tbody>
          </table></div>
          <small className="muted">Rojo: error que impide importar. Amarillo: posible duplicado (desmarcado por defecto; márquelo si es otra persona).</small>
        </div>
      )}
    </>
  )
}
