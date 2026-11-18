import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { saveMeasurement } from '../lib/offlineQueue'
import { ageFrom, normName } from '../lib/calc'
import { N_VARS, VARIABLES, pad, type Measurement, type Participant, type Profile, type Range, type Variable } from '../lib/types'
import { useToast } from './ui'

const CACHE = 'antropnutri.participants'

interface Props {
  campaignId: string
  variables: Variable[]
  ranges: Range[]
  profiles: Profile[]
  groupCode: (id: string) => string
  /** Para abrir un participante desde fuera (p. ej. al tocar una fila de la lista) */
  openNumber?: number | null
  onOpened?: () => void
}

type Loaded = { participant: Participant; measurements: Measurement[]; offline: boolean }

function cached(): Participant[] {
  try { return JSON.parse(localStorage.getItem(CACHE) ?? '[]') as Participant[] } catch { return [] }
}

export function MeasureForm({ campaignId, variables, ranges, profiles, groupCode, openNumber, onOpened }: Props) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Participant[] | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [current, setCurrent] = useState<Variable | null>(variables.length === 1 ? variables[0] : null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const toTop = () => setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  const toast = useToast()

  useEffect(() => { searchRef.current?.focus() }, [])
  useEffect(() => {
    if (openNumber) { setQuery(String(openNumber)); void search(String(openNumber)); onOpened?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNumber])

  async function open(p: Participant, offline = false) {
    setMatches(null); setError('')
    if (offline) { setLoaded({ participant: p, measurements: [], offline: true }); return }
    const { data, error: me } = await supabase.from('measurements').select('*').eq('participant_id', p.id)
    if (me) throw me
    setLoaded({ participant: p, measurements: data as Measurement[], offline: false })
  }

  async function search(qRaw?: string, e?: FormEvent) {
    e?.preventDefault()
    const q = (qRaw ?? query).trim()
    if (!q) return
    setError(''); setBusy(true); setMatches(null); setLoaded(null)
    try {
      let req = supabase.from('participants').select('*').eq('campaign_id', campaignId)
      if (/^\d{8}$/.test(q)) req = req.eq('dni', q)
      else if (/^\d{1,4}$/.test(q)) req = req.eq('number', parseInt(q, 10))
      else req = req.ilike('full_name', `%${q.replace(/\s+/g, '%')}%`)
      const { data, error: pe } = await req.order('number').limit(20)
      if (pe) throw pe
      const list = data as Participant[]
      if (list.length === 1) await open(list[0])
      else if (list.length === 0) setError(`No se encontró «${q}». Verifique o regístrelo con «+ Registrar participante».`)
      else setMatches(list)
    } catch (err) {
      // Sin conexión: buscar en la lista guardada en el dispositivo
      if (errorMessage(err).startsWith('Sin conexión') || !navigator.onLine) {
        const nq = normName(q)
        const list = cached().filter((p) => p.campaign_id === campaignId && (
          String(p.number) === q.replace(/^0+/, '') || p.dni === q || normName(p.full_name).includes(nq)))
        if (list.length === 1) await open(list[0], true)
        else if (list.length > 1) setMatches(list)
        else setError('Sin conexión y sin coincidencias en este dispositivo.')
      } else setError(errorMessage(err))
    } finally { setBusy(false) }
  }

  function choose(v: Variable) {
    setCurrent(v); setValue(''); setError('')
    setTimeout(() => valueRef.current?.focus(), 50)
  }

  function nextParticipant() {
    setLoaded(null); setMatches(null); setQuery(''); setValue(''); setError('')
    if (variables.length > 1) setCurrent(null)
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  const p = loaded?.participant
  const done = new Map(loaded?.measurements.map((m) => [m.variable, m]) ?? [])
  const currentMeta = VARIABLES.find((x) => x.key === current)
  const prev = current ? done.get(current) : undefined
  const who = (id: string) => profiles.find((x) => x.id === id)?.display_name

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!p || !current) return
    setError('')
    const v = Number(value.replace(',', '.').trim())
    const range = ranges.find((r) => r.variable === current)
    if (!isFinite(v) || v <= 0) return setError('Ingrese un número positivo.')
    if (range && (v < range.hard_min || v > range.hard_max)) return setError(`Valor fuera de lo permitido (${range.hard_min}–${range.hard_max}).`)
    setBusy(true)
    try {
      const r = await saveMeasurement({ number: p.number, variable: current, value: v, confirmUnusual: true })
      const label = currentMeta!.label
      if (r.sync === 'pendiente') {
        toast.show('warn', `${label}: guardado en el dispositivo, se enviará al volver la conexión.`)
        setLoaded({ ...loaded!, measurements: [...loaded!.measurements.filter((m) => m.variable !== current),
          { variable: current, value: v } as Measurement] })
      } else {
        toast.show('ok', r.result?.status === 'guardado' && r.result.remedicion
          ? `${label}: valor reemplazado (${Number(r.result.old_value)} → ${v}).` : `${label}: ${v} guardado.`)
        await open(p)
      }
      // Volver a los botones de medidas del mismo participante
      setValue('')
      if (variables.length > 1) setCurrent(null)
      toTop()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const age = p ? (p.age ?? ageFrom(p.birth_date)) : null

  return (
    <div className="card" ref={cardRef} style={{ scrollMarginTop: '4.5rem' }}>
      {toast.node}

      {!p && (
        <form onSubmit={(e) => void search(undefined, e)}>
          <label htmlFor="num">Buscar participante</label>
          <div className="row">
            <input id="num" ref={searchRef} className="huge grow search" autoComplete="off" value={query}
              onChange={(e) => { setQuery(e.target.value); setMatches(null); setError('') }} placeholder="N.º, DNI o nombre" />
            <button className="primary" disabled={!query.trim() || busy} style={{ alignSelf: 'stretch' }}>{busy ? '…' : 'Buscar'}</button>
          </div>
        </form>
      )}

      {error && <div className="alert err" style={{ marginTop: '.8rem' }}>{error}</div>}

      {matches && (
        <div className="matches">
          <p className="muted" style={{ margin: '.6rem 0 .4rem' }}>{matches.length} coincidencias. Toque el participante:</p>
          {matches.map((m) => (
            <button type="button" key={m.id} className="match" onClick={() => void open(m)}>
              <strong>{pad(m.number)}</strong>
              <span>{m.full_name}<small>{m.dni ? `DNI ${m.dni} · ` : ''}{groupCode(m.group_id)}</small></span>
            </button>
          ))}
        </div>
      )}

      {p && (
        <>
          {loaded!.offline && <div className="alert warn">Sin conexión: las medidas se guardan en el dispositivo y se enviarán al volver la conexión.</div>}
          <div className="participant-head" style={{ marginBottom: '.8rem' }}>
            <span className="num">{pad(p.number)}</span>
            <div className="grow">
              <strong style={{ fontSize: '1.1rem' }}>{p.full_name}</strong><br />
              <span className="muted">{p.dni ? `DNI ${p.dni} · ` : ''}{age ?? '—'} años · {groupCode(p.group_id)}</span>
            </div>
          </div>
          {!loaded!.offline && <p className="muted" style={{ fontSize: '.9rem', margin: '0 0 .6rem' }}>Avance: <strong>{done.size} de {N_VARS}</strong> medidas registradas</p>}

          {variables.length > 1 && (
            <>
              <label>{current ? 'Medida seleccionada' : '¿Qué medida va a registrar?'}</label>
              <div className="var-picker">
                {variables.map((v) => {
                  const m = VARIABLES.find((x) => x.key === v)!
                  const d = done.get(v)
                  return <button type="button" key={v} className={`${current === v ? 'primary' : ''} ${d ? 'is-done' : ''}`} aria-pressed={current === v}
                    onClick={() => choose(v)}>
                    {d && <span className="tick" aria-label="registrado">✓</span>}
                    {m.label}<small>{d ? `${Number(d.value)} ${m.unit}` : m.unit}</small></button>
                })}
              </div>
            </>
          )}

          {current && currentMeta && (
            <form onSubmit={submit} style={{ marginTop: '1rem' }}>
              <p className="measuring">Registrando: <strong>{currentMeta.label}</strong> ({currentMeta.unit})</p>
              {prev && (
                <div className="alert warn">Ya registrado: <strong>{Number(prev.value)} {currentMeta.unit}</strong>{prev.evaluator_id && who(prev.evaluator_id) ? ` (${who(prev.evaluator_id)})` : ''}. Si escribe un nuevo valor, reemplazará al anterior.</div>
              )}
              <div className="field">
                <label htmlFor="valor">{prev ? 'Nuevo valor' : 'Valor'} ({currentMeta.unit})</label>
                <input id="valor" ref={valueRef} className="huge" inputMode="decimal" autoComplete="off" value={value}
                  onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={currentMeta.unit} />
              </div>
              <div className="row">
                <button className="primary big grow" disabled={busy || !value}>{busy ? 'Guardando…' : prev ? 'Reemplazar valor' : 'Guardar'}</button>
                {variables.length > 1 && <button type="button" className="big" style={{ width: 'auto' }} onClick={() => setCurrent(null)}>Volver</button>}
              </div>
            </form>
          )}

          <button type="button" className="big next-btn" onClick={nextParticipant}>Siguiente participante →</button>
        </>
      )}
    </div>
  )
}

export function cacheParticipants(list: Participant[]) {
  try { localStorage.setItem(CACHE, JSON.stringify(list)) } catch { /* */ }
}
