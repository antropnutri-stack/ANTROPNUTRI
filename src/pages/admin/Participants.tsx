import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useConfig, type Config } from '../../lib/hooks'
import { supabase, errorMessage } from '../../lib/supabase'
import { normName } from '../../lib/calc'
import { STATUS_LABEL, VARIABLES, pad, type EvalStatus, type Measurement, type ParticipantResult } from '../../lib/types'
import { Modal, StatusBadge, useToast } from '../../components/ui'
import { RegisterParticipant } from '../../components/RegisterParticipant'
import { useOperations } from './data'

export default function Participants() {
  const { data: cfg } = useConfig()
  const { data, refresh } = useOperations()
  const { can } = useAuth()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
  const [estado, setEstado] = useState<EvalStatus | ''>('')
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const rows = useMemo(() => (data?.results ?? []).filter((r) =>
    (!group || r.group_id === group) && (!estado || r.estado === estado) &&
    (!q || pad(r.number).includes(q) || (r.dni ?? '').includes(q) || normName(r.full_name).includes(normName(q)))), [data, q, group, estado])

  if (!cfg || !data) return <p className="muted">Cargando…</p>
  const sel = data.results.find((r) => r.id === open)

  return (
    <>
      <div className="row"><h1 className="grow">Participantes</h1>
        {can('can_manage_participants') && <button className="primary" onClick={() => setAdding(true)}>+ Registro manual</button>}</div>
      <div className="card row">
        <input className="grow" placeholder="Buscar por número, DNI o nombre" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200 }} />
        <select style={{ width: 'auto' }} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">Todas las promociones</option>{cfg.groups.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}
        </select>
        <select style={{ width: 'auto' }} value={estado} onChange={(e) => setEstado(e.target.value as EvalStatus)}>
          <option value="">Todos los estados</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="muted">{rows.length} de {data.results.length}</span>
      </div>
      <div className="card table-wrap" style={{ maxHeight: '70vh', padding: 0 }}>
        <table>
          <thead><tr><th>N.º</th><th>Promoción</th><th>Nombre</th><th>DNI</th><th className="num">Edad</th>
            {VARIABLES.map((v) => <th key={v.key} className="num">{v.short}</th>)}
            <th className="num">IMC</th><th className="num">RCT</th><th className="num">ICC</th><th className="num">CMB</th><th className="num">Σ pliegues</th><th>Estado</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
              <td><strong>{pad(r.number)}</strong></td><td>{r.group_code}</td><td>{r.full_name}</td><td>{r.dni ?? ''}</td><td className="num">{r.age ?? ''}</td>
              {VARIABLES.map((v) => <td key={v.key} className="num">{r[v.key] ?? '·'}</td>)}
              <td className="num" title={r.imc_clasificacion ?? ''}>{r.imc ?? ''}</td><td className="num">{r.rct ?? ''}</td><td className="num">{r.icc ?? ''}</td><td className="num">{r.cmb ?? ''}</td><td className="num">{r.suma_pliegues ?? ''}</td>
              <td><StatusBadge estado={r.estado} />{r.any_unusual && <span className="badge warn" title="Valor inusual confirmado"> !</span>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {sel && <ParticipantDetail r={sel} cfg={cfg} measurements={data.measurements.filter((m) => m.participant_id === sel.id)} onClose={() => setOpen(null)} onChange={refresh} />}
      {adding && <Modal title="Registro manual" onClose={() => setAdding(false)}>
        <RegisterParticipant groups={cfg.groups} onDone={() => void refresh()} />
      </Modal>}
    </>
  )
}

function ParticipantDetail({ r, cfg, measurements, onClose, onChange }: {
  r: ParticipantResult; cfg: Config; measurements: Measurement[]; onClose: () => void; onChange: () => void
}) {
  const { can } = useAuth()
  const toast = useToast()
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ full_name: r.full_name, dni: r.dni ?? '', sex: r.sex ?? '', age: String(r.age ?? '') })
  const who = (id: string) => cfg.profiles.find((p) => p.id === id)?.display_name ?? '—'

  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    const { error } = await supabase.rpc(fn, args)
    if (error) toast.show('err', errorMessage(error)); else { toast.show('ok', ok); onChange() }
  }
  const ask = (msg: string) => { const x = prompt(msg); return x && x.trim().length >= 3 ? x.trim() : null }

  return (
    <Modal title={`Participante ${pad(r.number)}`} onClose={onClose}>
      {toast.node}
      {!edit ? (
        <p><strong>{r.full_name}</strong><br /><span className="muted">{r.dni ? `DNI ${r.dni} · ` : ''}{r.age ?? '—'} años · {r.group_code}{r.sex ? ` · ${r.sex === 'F' ? 'Femenino' : 'Masculino'}` : ''}</span><br />
          <StatusBadge estado={r.estado} /> {r.review_note && <small className="muted">Revisión: {r.review_note}</small>}</p>
      ) : (
        <div>
          <div className="field"><label>Nombres y apellidos</label><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
          <div className="row">
            <div className="field grow"><label>DNI</label><input inputMode="numeric" maxLength={8} value={f.dni} onChange={(e) => setF({ ...f, dni: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="field grow"><label>Edad</label><input value={f.age} onChange={(e) => setF({ ...f, age: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="field grow"><label>Sexo</label><select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option></select></div>
          </div>
          <div className="row" style={{ marginBottom: '1rem' }}>
            <button className="primary" onClick={() => { const reason = ask('Motivo de la corrección:'); if (reason) void run('update_participant', { p_id: r.id, p_full_name: f.full_name, p_dni: f.dni || null, p_age: f.age ? +f.age : null, p_sex: f.sex || null, p_birth_date: null, p_reason: reason }, 'Datos corregidos').then(() => setEdit(false)) }}>Guardar</button>
            <button onClick={() => setEdit(false)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="table-wrap"><table><thead><tr><th>Medición</th><th className="num">Valor</th><th>Evaluador</th><th /></tr></thead>
        <tbody>{VARIABLES.map((v) => {
          const m = measurements.find((x) => x.variable === v.key)
          return (
            <tr key={v.key}><td>{v.label}</td><td className="num">{m ? `${Number(m.value)} ${v.unit}` : '—'}{m?.is_unusual && <span className="badge warn"> inusual</span>}</td>
              <td>{m ? who(m.evaluator_id) : ''}</td>
              <td>{m && can('can_manage_participants') && <span className="row">
                <button onClick={() => { const nv = prompt(`Nuevo valor para ${v.label} (${v.unit}):`, String(m.value)); if (!nv) return; const reason = ask('Motivo de la corrección:'); if (reason) void run('correct_measurement', { p_measurement_id: m.id, p_new_value: Number(nv.replace(',', '.')), p_reason: reason }, 'Medición corregida') }}>Corregir</button>
                <button onClick={() => { const reason = ask('Motivo para anular (la estación deberá medir de nuevo):'); if (reason) void run('delete_measurement', { p_measurement_id: m.id, p_reason: reason }, 'Medición anulada') }}>Anular</button>
              </span>}</td></tr>
          )
        })}</tbody></table></div>
      <p className="muted" style={{ marginTop: '.6rem' }}>IMC: {r.imc ?? '—'} {r.imc_clasificacion ? `(${r.imc_clasificacion})` : ''} · RCT: {r.rct ?? '—'} · ICC: {r.icc ?? '—'} · CMB estimada: {r.cmb ?? '—'} cm · Σ 4 pliegues: {r.suma_pliegues ?? '—'} mm</p>

      <div className="row" style={{ marginTop: '1rem' }}>
        {can('can_manage_participants') && !edit && <button onClick={() => setEdit(true)}>Editar datos</button>}
        <button className="danger" onClick={() => {
          if (!confirm(`¿Borrar al participante ${pad(r.number)} (${r.full_name}) y todas sus medidas? Esta acción no se puede deshacer.`)) return
          void run('delete_participant', { p_id: r.id, p_reason: 'Borrado por administración' }, 'Participante borrado').then(onClose)
        }}>Borrar participante</button>
        <button onClick={() => { const note = r.needs_review ? null : ask('Motivo de la revisión:'); if (r.needs_review || note) void run('set_review', { p_id: r.id, p_needs_review: !r.needs_review, p_note: note }, 'Estado actualizado') }}>
          {r.needs_review ? 'Marcar revisión resuelta' : 'Marcar «requiere revisión»'}</button>
        {can('can_change_group') && (
          <select style={{ width: 'auto' }} value="" onChange={(e) => { const g = e.target.value; const reason = g && ask('Motivo del cambio de promoción:'); if (g && reason) void run('change_participant_group', { p_id: r.id, p_group_id: g, p_reason: reason }, 'Promoción cambiada') }}>
            <option value="">Cambiar promoción…</option>
            {cfg.groups.filter((g) => g.id !== r.group_id).map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}
          </select>
        )}
      </div>
    </Modal>
  )
}
