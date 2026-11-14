import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { saveMeasurement } from '../lib/offlineQueue'
import { ageFrom, cmb, imc, rct } from '../lib/calc'
import { VARIABLES, pad, type Measurement, type Participant, type Profile, type Range, type Variable } from '../lib/types'
import { Modal, useToast } from './ui'

const CACHE = 'antropnutri.participants'

interface Props {
  campaignId: string
  variables: Variable[]
  ranges: Range[]
  profiles: Profile[]
  groupCode: (id: string) => string
  onRequestSupport?: (number: number) => void
}

type Loaded = { participant: Participant | null; measurements: Measurement[]; offline: boolean }

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
      if (p) {
        const { data, error: me } = await supabase.from('measurements').select('*').eq('participant_id', p.id)
        if (me) throw me
        ms = data as Measurement[]
      }
      setLoaded({ participant: p as Participant | null, measurements: ms, offline: false })
    } catch (err) {
      // Sin conexión: verificar con la lista guardada en el dispositivo
      let cached: Participant | undefined
      try { cached = (JSON.parse(localStorage.getItem(CACHE) ?? '[]') as Participant[]).find((x) => x.number === n) } catch { /* */ }
      if (errorMessage(err).startsWith('Sin conexión') || !navigator.onLine) {
        setLoaded({ participant: cached ?? null, measurements: [], offline: true })
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
  const pendingVars = variables.filter((v) => !done.has(v))

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
    let pending = 0, saved = 0
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
        else saved++
      } catch (err) { problems.push(errorMessage(err)) }
    }
    setBusy(false)
    if (problems.length) { setError(problems.join(' ')); if (!saved && !pending) return }
    toast.show(pending ? 'warn' : 'ok', pending
      ? `Participante ${pad(n)}: ${pending} guardado(s) en el dispositivo, pendiente de sincronizar.`
      : `Participante ${pad(n)}: ${saved} medición(es) guardada(s) en servidor.`)
    if (!problems.length) reset()
  }

  const p = loaded?.participant
  const age = p ? (p.age ?? ageFrom(p.birth_date)) : null
  const val = (v: Variable) => {
    const m = done.get(v); if (m) return Number(m.value)
    const x = Number((values[v] ?? '').replace(',', '.')); return x > 0 ? x : null
  }

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
          El participante {pad(parseInt(numberText, 10))} no está registrado o pertenece a otro grupo sin apoyo autorizado.
          {onRequestSupport && <> <button className="link" onClick={() => onRequestSupport(parseInt(numberText, 10))}>Solicitar apoyo</button></>}
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
                <span className="muted">{p.sex === 'F' ? 'Femenino' : 'Masculino'} · {age ?? '—'} años · Grupo {groupCode(p.group_id)}</span>
              </div>
            </div>
          )}
          {!loaded.offline && (
            <div className="checklist" style={{ marginBottom: '1rem' }}>
              {VARIABLES.map((v) => <div key={v.key} className={done.has(v.key) ? 'done' : ''}>{done.has(v.key) ? '✓' : '○'} {v.short}{done.has(v.key) && `: ${Number(done.get(v.key)!.value)}`}</div>)}
            </div>
          )}
          {pendingVars.length === 0 ? (
            <div className="alert ok">Las mediciones de su estación ya están registradas para este participante.</div>
          ) : pendingVars.map((v, i) => {
            const meta = VARIABLES.find((x) => x.key === v)!
            const r = ranges.find((x) => x.variable === v)
            return (
              <div className="field" key={v}>
                <label htmlFor={v}>{meta.label} ({meta.unit})</label>
                <input id={v} ref={i === 0 ? firstValRef : undefined} className="huge" inputMode="decimal" autoComplete="off"
                  value={values[v] ?? ''} onChange={(e) => setValues({ ...values, [v]: e.target.value.replace(/[^\d.,]/g, '') })}
                  placeholder={r ? `${r.warn_min}–${r.warn_max}` : ''} />
                <small>Valor final validado según el protocolo de medición.</small>
              </div>
            )
          })}
          {p && <Indicators peso={val('peso')} talla={val('talla')} cintura={val('cintura')} pb={val('perimetro_braquial')} pct={val('pliegue_tricipital')} />}
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

function Indicators({ peso, talla, cintura, pb, pct }: Record<'peso' | 'talla' | 'cintura' | 'pb' | 'pct', number | null>) {
  const items = [
    ['IMC', imc(peso, talla), 'kg/m²'], ['Cintura/talla', rct(cintura, talla), ''], ['CMB estimada', cmb(pb, pct), 'cm'],
  ].filter(([, v]) => v != null)
  if (!items.length) return null
  return <p className="muted" style={{ fontSize: '.9rem' }}>{items.map(([k, v, u]) => `${k}: ${v} ${u}`).join(' · ')}</p>
}

export function cacheParticipants(list: Participant[]) {
  try { localStorage.setItem(CACHE, JSON.stringify(list)) } catch { /* */ }
}
