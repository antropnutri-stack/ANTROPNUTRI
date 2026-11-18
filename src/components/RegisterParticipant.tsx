import { useState, type FormEvent } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { pad, type Group } from '../lib/types'

export function RegisterParticipant({ groups, onDone }: { groups: Group[]; onDone?: (n: number) => void }) {
  const empty = { full_name: '', dni: '', age: '', group_id: '', sex: '' }
  const [f, setF] = useState(empty)
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null)
  const [dup, setDup] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent | null, force = false) {
    e?.preventDefault(); setMsg(null)
    if (!f.group_id) return setMsg({ kind: 'err', text: 'Seleccione la promoción.' })
    if (f.dni && !/^\d{8}$/.test(f.dni)) return setMsg({ kind: 'err', text: 'El DNI debe tener 8 dígitos.' })
    setBusy(true)
    const { data, error } = await supabase.rpc('register_participant', {
      p_full_name: f.full_name, p_dni: f.dni || null, p_age: f.age ? parseInt(f.age, 10) : null,
      p_group_id: f.group_id, p_sex: f.sex || null, p_force: force,
    })
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: errorMessage(error) })
    if (data.status === 'posible_duplicado') {
      setDup(`Ya existe «${data.full_name}» con el número ${pad(data.number)}. ¿Es otra persona?`)
      return
    }
    setDup(null)
    setMsg({ kind: 'ok', text: `Registrado con el número ${pad(data.number)}.` })
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
        <div className="field"><label>DNI</label>
          <input inputMode="numeric" maxLength={8} value={f.dni} onChange={(e) => setF({ ...f, dni: e.target.value.replace(/\D/g, '') })} placeholder="8 dígitos" /></div>
        <div className="field"><label>Edad (años)</label>
          <input inputMode="numeric" maxLength={3} value={f.age} onChange={(e) => setF({ ...f, age: e.target.value.replace(/\D/g, '') })} required /></div>
      </div>
      <div className="field"><label>Promoción</label>
        <div className="var-picker">
          {groups.map((g) => (
            <button type="button" key={g.id} className={f.group_id === g.id ? 'primary' : ''} aria-pressed={f.group_id === g.id}
              onClick={() => setF({ ...f, group_id: g.id })}>{g.code}</button>
          ))}
        </div>
      </div>
      <div className="field"><label>Sexo (opcional)</label>
        <select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}>
          <option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option>
        </select></div>
      <button className="primary big" disabled={busy}>{busy ? 'Registrando…' : 'Registrar y asignar número'}</button>
    </form>
  )
}
