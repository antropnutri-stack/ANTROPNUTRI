import { useState, type FormEvent } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { REQUEST_TYPE_LABEL, VARIABLES, type Group, type RequestType, type Variable } from '../lib/types'
import { Modal } from './ui'

export function SupportRequestForm({ groups, ownGroupId, initialNumber, initialType, initialVariable, onClose, onDone }: {
  groups: Group[]; ownGroupId: string | null; initialNumber?: number; initialType?: RequestType; initialVariable?: Variable
  onClose: () => void; onDone: () => void
}) {
  const [number, setNumber] = useState(initialNumber ? String(initialNumber) : '')
  const [type, setTypeRaw] = useState<RequestType>(initialType ?? 'apoyo_temporal')
  const otherGroup = groups.find((g) => g.id !== ownGroupId)?.id ?? ''
  const [target, setTarget] = useState(initialType === 'remedicion' ? (ownGroupId ?? '') : otherGroup)
  const [vars, setVars] = useState<Variable[]>(initialVariable ? [initialVariable] : [])
  const setType = (t: RequestType) => {
    setTypeRaw(t)
    if (t === 'remedicion') setTarget(ownGroupId ?? '')
    else if (target === ownGroupId) setTarget(otherGroup)
    if (t === 'apoyo_temporal' && vars.length > 1) setVars(vars.slice(0, 1))
  }
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    if (type !== 'traslado' && vars.length === 0) return setError('Seleccione las mediciones que requieren apoyo.')
    if (type === 'apoyo_temporal' && vars.length > 1) return setError('El apoyo temporal es para una medición; use «Apoyo para varias mediciones».')
    setBusy(true)
    const { error } = await supabase.rpc('create_support_request', {
      p_participant_number: parseInt(number, 10), p_type: type, p_reason: reason,
      p_target_group_id: target, p_variables: type === 'traslado' ? [] : vars,
    })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    onDone()
  }

  return (
    <Modal title={type === 'remedicion' ? 'Solicitar volver a medir' : 'Solicitar apoyo'} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="alert err">{error}</div>}
        <div className="field">
          <label>Número del participante</label>
          <input inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} required />
        </div>
        <div className="field">
          <label>Tipo de solicitud</label>
          <select value={type} onChange={(e) => setType(e.target.value as RequestType)}>
            {Object.entries(REQUEST_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <small>{type === 'traslado' ? 'Cambia el grupo asignado; el número se conserva.'
            : type === 'remedicion' ? 'Para repetir una medición ya registrada. Al aprobarse, el nuevo valor reemplaza al anterior (que queda en el historial).'
            : 'El participante conserva su grupo; otro grupo realiza solo las mediciones autorizadas.'}</small>
        </div>
        <div className="field">
          <label>{type === 'remedicion' ? '¿Quién vuelve a medir?' : 'Grupo de destino'}</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} required>
            {groups.filter((g) => type === 'remedicion' || g.id !== ownGroupId).map((g) => (
              <option key={g.id} value={g.id}>Grupo {g.code}{g.id === ownGroupId ? ' (mi grupo)' : ''}</option>))}
          </select>
        </div>
        {type !== 'traslado' && (
          <div className="field">
            <label>{type === 'remedicion' ? 'Mediciones a repetir' : 'Mediciones a autorizar'}</label>
            {VARIABLES.map((v) => (
              <label key={v.key} className="check">
                <input type={type === 'apoyo_temporal' ? 'radio' : 'checkbox'} name="vars" checked={vars.includes(v.key)}
                  onChange={(e) => setVars(type === 'apoyo_temporal' ? [v.key] : e.target.checked ? [...vars, v.key] : vars.filter((x) => x !== v.key))} />
                {v.label}
              </label>
            ))}
            <small>{type === 'remedicion' ? 'Solo se pueden repetir mediciones ya registradas.' : 'Solo se habilitarán las mediciones que aún estén pendientes.'}</small>
          </div>
        )}
        <div className="field">
          <label>Motivo</label>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3}
            placeholder={type === 'remedicion' ? 'Ej.: el participante se movió, lectura dudosa, error de digitación…' : 'Ej.: balanza en calibración, cola excesiva en la estación…'} />
        </div>
        <div className="row">
          <button className="primary grow" disabled={busy}>{busy ? 'Enviando…' : 'Enviar solicitud'}</button>
          <button type="button" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Modal>
  )
}
