import { useState, type FormEvent } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { pad, type Group } from '../lib/types'

export function RegisterParticipant({ groups, defaultGroupId, chooseGroup, onDone }: {
  groups: Group[]; defaultGroupId: string | null; chooseGroup: boolean; onDone?: (n: number) => void
}) {
  const empty = { full_name: '', sex: '', birth_date: '', age: '', group_id: defaultGroupId ?? groups[0]?.id ?? '' }
  const [f, setF] = useState(empty)
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null)
  const [dup, setDup] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent | null, force = false) {
    e?.preventDefault(); setMsg(null)
    if (!f.birth_date && !f.age) return setMsg({ kind: 'err', text: 'Indique la fecha de nacimiento o la edad.' })
    setBusy(true)
    const { data, error } = await supabase.rpc('register_participant', {
      p_full_name: f.full_name, p_sex: f.sex, p_birth_date: f.birth_date || null,
      p_age: f.age ? parseInt(f.age, 10) : null, p_group_id: chooseGroup ? f.group_id : null, p_force: force,
    })
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: errorMessage(error) })
    if (data.status === 'posible_duplicado') {
      setDup(`Ya existe «${data.full_name}» con el número ${pad(data.number)}. ¿Es otra persona?`)
      return
    }
    setDup(null)
    setMsg({ kind: 'ok', text: `Registrado con el número ${pad(data.number)}. Entregue la tarjeta numerada.` })
    setF({ ...empty, group_id: f.group_id })
    onDone?.(data.number)
  }

  return (
    <form onSubmit={submit}>
      {msg && <div className={`alert ${msg.kind}`} style={msg.kind === 'ok' ? { fontSize: '1.15rem', fontWeight: 700 } : {}}>{msg.text}</div>}
      {dup && (
        <div className="alert warn">{dup}
          <div className="row" style={{ marginTop: '.5rem' }}>
            <button type="button" onClick={() => void submit(null, true)}>Sí, registrar como nuevo</button>
            <button type="button" onClick={() => setDup(null)}>No, cancelar</button>
          </div>
        </div>
      )}
      <div className="field"><label>Nombres y apellidos</label>
        <input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required minLength={3} /></div>
      <div className="grid cols-2" style={{ gap: '.6rem' }}>
        <div className="field"><label>Sexo (referencias antropométricas)</label>
          <select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })} required>
            <option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option>
          </select></div>
        <div className="field"><label>Fecha de nacimiento</label>
          <input type="date" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })} /></div>
        <div className="field"><label>Edad (si no hay fecha)</label>
          <input inputMode="numeric" value={f.age} disabled={!!f.birth_date} onChange={(e) => setF({ ...f, age: e.target.value.replace(/\D/g, '') })} /></div>
        {chooseGroup && <div className="field"><label>Grupo</label>
          <select value={f.group_id} onChange={(e) => setF({ ...f, group_id: e.target.value })}>
            {groups.map((g) => <option key={g.id} value={g.id}>Grupo {g.code} ({pad(g.range_start)}–{pad(g.range_end)})</option>)}
          </select></div>}
      </div>
      <button className="primary big" disabled={busy}>{busy ? 'Registrando…' : 'Registrar y asignar número'}</button>
    </form>
  )
}
