import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { saveMeasurement } from '../lib/offlineQueue'
import { ageFrom } from '../lib/calc'
import { N_VARS, VARIABLES, pad, type Measurement, type Participant, type Profile, type Range, type SupportRequest, type Variable } from '../lib/types'
import { Modal, useToast } from './ui'

const CACHE = 'antropnutri.participants'

interface Props {
  campaignId: string
  variables: Variable[]
  ranges: Range[]
  profiles: Profile[]
  groupCode: (id: string) => string
  onRequestSupport?: (number: number, opts?: { type: 'remedicion'; variable: Variable }) => void
}

type Loaded = { participant: Participant | null; measurements: Measurement[]; requests: SupportRequest[]; offline: boolean }

export function MeasureForm({ campaignId, variables, ranges, profiles, groupCode, onRequestSupport }: Props) {
  const [numberText, setNumberText] = useState('')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [values, setValues] = useState<Partial<Record<Variable, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<{ items: { v: Variable; value: number; range: Range }[] } | null>(null)
  const numRef = useRef<HTMLInputElement>(null)
  const firstValRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  // Medición que el evaluador está tomando (se recuerda en el dispositivo)
  const SEL = 'antropnutri.variable'
  const [current, setCurrent] = useState<Variable | null>(() => {
    if (variables.length === 1) return variables[0]
    try { const v = localStorage.getItem(SEL) as Variable | null; return v && variables.includes(v) ? v : null } catch { return null }
  })
  useEffect(() => { if (variables.length === 1) setCurrent(variables[0]) }, [variables])
  function choose(v: Variable) {
    setCurrent(v); setValues({}); setError('')
    try { localStorage.setItem(SEL, v) } catch { /* */ }
    setTimeout(() => (loaded ? firstValRef : numRef).current?.focus(), 50)
  }
  const currentMeta = VARIABLES.find((x) => x.key === current)

  useEffect(() => { numRef.current?.focus() }, [])

  async function lookup(e?: FormEvent) {
    e?.preventDefault()
    const n = parseInt(numberText, 10)
    if (!n) return
    setError(''); setBusy(true)
    try {
      const { data: p, error: pe } = await supabase.from('participants').select('*').eq('campaign_id', campaignId).eq('number', n).maybeSingle()
      if (pe) throw pe
      let ms: Measurement[] = []
      let rs: SupportRequest[] = []
      if (p) {
        const [m, r] = await Promise.all([
          supabase.from('measurements').select('*').eq('participant_id', p.id),
          supabase.from('support_requests').select('*').eq('participant_id', p.id).eq('type', 'remedicion').in('status', ['pendiente', 'aprobada']),
        ])
        if (m.error) throw m.error
        ms = m.data as Measurement[]
        rs = (r.data as SupportRequest[] | null) ?? []
      }
      setLoaded({ participant: p as Participant | null, measurements: ms, requests: rs, offline: false })
    } catch (err) {
      // Sin conexión: verificar con la lista guardada en el dispositivo
      let cached: Participant | undefined
      try { cached = (JSON.parse(localStorage.getItem(CACHE) ?? '[]') as Participant[]).find((x) => x.number === n) } catch { /* */ }
      if (errorMessage(err).startsWith('Sin conexión') || !navigator.onLine) {
        setLoaded({ participant: cached ?? null, measurements: [], requests: [], offline: true })
      } else setError(errorMessage(err))
    } finally {
      setBusy(false)
      setValues({})
      setTimeout(() => firstValRef.current?.focus(), 50)
    }
  }

  function reset() {
    setLoaded(null); setNumberText(''); setValues({}); setError('')
    setTimeout(() => numRef.current?.focus(), 50)
  }

  const done = new Map(loaded?.measurements.map((m) => [m.variable, m]) ?? [])
  // Re-medición autorizada para la variable actual (o en trámite)
  const redo = current ? loaded?.requests.find((r) => r.status === 'aprobada' && r.variables.includes(current) && !(r.done_variables ?? []).includes(current)) : undefined
  const redoPending = current ? loaded?.requests.find((r) => r.status === 'pendiente' && r.variables.includes(current)) : undefined
  const pendingVars = current && (!done.has(current) || redo) ? [current] : []
  const prev = current ? done.get(current) : undefined
  const prevWho = prev ? profiles.find((x) => x.id === prev.evaluator_id)?.display_name : undefined

  function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const items: { v: Variable; value: number; range: Range }[] = []
    for (const v of pendingVars) {
      const raw = (values[v] ?? '').replace(',', '.').trim()
      if (!raw) continue
      const value = Number(raw)
      const range = ranges.find((r) => r.variable === v)!
      const label = VARIABLES.find((x) => x.key === v)!.label
      if (!isFinite(value) || value <= 0) return setError(`${label}: ingrese un número positivo.`)
      if (value < range.hard_min || value > range.hard_max)
        return setError(`${label}: ${value} ${range.unit} está fuera del rango admisible (${range.hard_min}–${range.hard_max}). Verifique la unidad.`)
      items.push({ v, value, range })
    }
    if (!items.length) return setError('Ingrese al menos un valor.')
    const unusual = items.filter((i) => i.value < i.range.warn_min || i.value > i.range.warn_max)
    if (unusual.length) setConfirm({ items })
    else void doSave(items, false)
  }

  async function doSave(items: { v: Variable; value: number }[], confirmUnusual: boolean) {
    setConfirm(null); setBusy(true)
    const n = parseInt(numberText, 10)
    let pending = 0, saved = 0, redone = 0
    const problems: string[] = []
    for (const it of items) {
      try {
        const r = await saveMeasurement({ number: n, variable: it.v, value: it.value, confirmUnusual })
        if (r.sync === 'pendiente') pending++
        else if (r.result?.status === 'ya_existe') {
          const evaluatorId = r.result.evaluator_id
          const who = profiles.find((p) => p.id === evaluatorId)?.display_name
          problems.push(`${VARIABLES.find((x) => x.key === it.v)!.short}: ya registrado (${r.result.value})${who ? ' por ' + who : ''}. Solicite corrección a administración si es necesario.`)
        } else if (r.result?.status === 'requiere_confirmacion') problems.push('El servidor requiere confirmar un valor inusual.')
        else { saved++; if (r.result?.status === 'guardado' && r.result.remedicion) redone++ }
      } catch (err) { problems.push(errorMessage(err)) }
    }
    setBusy(false)
    if (problems.length) { setError(problems.join(' ')); if (!saved && !pending) return }
    toast.show(pending ? 'warn' : 'ok', pending
      ? `Participante ${pad(n)}: ${pending} guardado(s) en el dispositivo, pendiente de sincronizar.`
      : redone ? `Participante ${pad(n)}: medición repetida y guardada (reemplaza el valor anterior).`
      : `Participante ${pad(n)}: ${saved} medición(es) guardada(s) en servidor.`)
    if (!problems.length) reset()
  }

  const p = loaded?.participant
  const age = p ? (p.age ?? ageFrom(p.birth_date)) : null

  return (
    <div className="card">
      {toast.node}
      <form onSubmit={lookup}>
        <label htmlFor="num">Número del participante</label>
        <div className="row">
          <input id="num" ref={numRef} className="huge grow" inputMode="numeric" pattern="[0-9]*" maxLength={4}
            value={numberText} onChange={(e) => { setNumberText(e.target.value.replace(/\D/g, '')); setLoaded(null) }} placeholder="000" />
          <button className="primary" disabled={!numberText || busy} style={{ alignSelf: 'stretch' }}>Buscar</button>
        </div>
      </form>

      {error && <div className="alert err" style={{ marginTop: '.8rem' }}>{error}</div>}

      {loaded && !p && !loaded.offline && (
        <div className="alert warn" style={{ marginTop: '.8rem' }}>
          El participante {pad(parseInt(numberText, 10))} no está registrado. Regístrelo primero con «+ Registrar participante».
        </div>
      )}

      {loaded && (p || loaded.offline) && (
        <form onSubmit={submit} style={{ marginTop: '1rem' }}>
          {loaded.offline && (
            <div className="alert warn">Sin conexión. {p ? 'Datos verificados con la lista guardada en este dispositivo.' : 'No se pudo verificar al participante: confirme el número con su tarjeta.'} La medición se sincronizará al volver la conexión.</div>
          )}
          {p && (
            <div className="participant-head" style={{ marginBottom: '.8rem' }}>
              <span className="num">{pad(p.number)}</span>
              <div>
                <strong style={{ fontSize: '1.1rem' }}>{p.full_name}</strong><br />
                <span className="muted">{p.dni ? `DNI ${p.dni} · ` : ''}{age ?? '—'} años · {groupCode(p.group_id)}</span>
              </div>
            </div>
          )}
          {!loaded.offline && (
            <p className="muted" style={{ fontSize: '.9rem', margin: '0 0 .6rem' }}>Avance: <strong>{done.size} de {N_VARS}</strong> mediciones registradas</p>
          )}
          {variables.length > 1 && (
        <div style={{ marginBottom: '1rem' }}>
          <label>¿Qué medición va a registrar?</label>
          <div className="var-picker">
            {variables.map((v) => {
              const m = VARIABLES.find((x) => x.key === v)!
              const d = loaded && !loaded.offline ? done.get(v) : undefined
              return <button type="button" key={v} className={`${current === v ? 'primary' : ''} ${d ? 'is-done' : ''}`} aria-pressed={current === v}
                onClick={() => choose(v)}>
                {d && <span className="tick" aria-label="registrado">✓</span>}
                {m.label}<small>{d ? `${Number(d.value)} ${m.unit}` : m.unit}</small></button>
            })}
          </div>
        </div>
      )}
          {!current ? <p className="muted">Toque la medición que va a registrar.</p> : <>
          <p className="measuring">Registrando: <strong>{currentMeta!.label}</strong> ({currentMeta!.unit})</p>
          {pendingVars.length === 0 ? (
            <div className="alert ok">
              {currentMeta!.label} ya está registrado para este participante{prev ? `: ${Number(prev.value)} ${currentMeta!.unit}` : ''}{prevWho ? ` (${prevWho})` : ''}.
              {redoPending ? (
                <div style={{ marginTop: '.5rem' }}><span className="badge warn">Solicitud para volver a medir pendiente de aprobación</span></div>
              ) : onRequestSupport && p && (
                <div style={{ marginTop: '.6rem' }}>
                  <button type="button" onClick={() => onRequestSupport(p.number, { type: 'remedicion', variable: current! })}>Solicitar volver a medir</button>
                </div>
              )}
            </div>
          ) : pendingVars.map((v, i) => {
            const meta = VARIABLES.find((x) => x.key === v)!
            return (
              <div className="field" key={v}>
                {redo && prev && <div className="alert warn">Re-medición autorizada. El valor anterior ({Number(prev.value)} {meta.unit}{prevWho ? `, ${prevWho}` : ''}) será reemplazado y quedará en el historial.</div>}
                <label htmlFor="valor">{redo ? 'Nuevo valor · ' : ''}{meta.label} ({meta.unit})</label>
                <input id="valor" ref={i === 0 ? firstValRef : undefined} className="huge" inputMode="decimal" autoComplete="off"
                  value={values[v] ?? ''} onChange={(e) => setValues({ ...values, [v]: e.target.value.replace(/[^\d.,]/g, '') })}
                  placeholder={meta.unit} />
              </div>
            )
          })}
          </>}
          <div className="row" style={{ marginTop: '.6rem' }}>
            {pendingVars.length > 0 && <button className="primary big grow" disabled={busy}>{busy ? 'Guardando…' : 'Guardar y siguiente'}</button>}
            <button type="button" className="big" style={{ width: 'auto' }} onClick={reset}>{pendingVars.length ? 'Cancelar' : 'Siguiente'}</button>
          </div>
        </form>
      )}

      {confirm && (
        <Modal title="Confirmar valor inusual" onClose={() => setConfirm(null)}>
          {confirm.items.filter((i) => i.value < i.range.warn_min || i.value > i.range.warn_max).map((i) => (
            <p key={i.v}><strong>{VARIABLES.find((x) => x.key === i.v)!.label}: {i.value} {i.range.unit}</strong><br />
              <span className="muted">Fuera del rango habitual ({i.range.warn_min}–{i.range.warn_max} {i.range.unit}).</span></p>
          ))}
          <p>Verifique la lectura y la unidad. Si el valor es correcto, confírmelo; quedará marcado como inusual verificado.</p>
          <div className="row">
            <button className="primary grow" onClick={() => void doSave(confirm.items, true)}>Sí, el valor es correcto</button>
            <button className="grow" onClick={() => setConfirm(null)}>Corregir</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export function cacheParticipants(list: Participant[]) {
  try { localStorage.setItem(CACHE, JSON.stringify(list)) } catch { /* */ }
}
