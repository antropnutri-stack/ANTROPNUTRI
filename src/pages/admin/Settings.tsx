import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { q, useConfig } from '../../lib/hooks'
import { supabase, errorMessage } from '../../lib/supabase'
import { VARIABLES, pad, type Campaign, type Group, type Range } from '../../lib/types'
import { useToast } from '../../components/ui'

export default function Settings() {
  const { data: cfg, refresh } = useConfig()
  const toast = useToast()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [ranges, setRanges] = useState<Range[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const loadCampaigns = () => q<Campaign[]>(supabase.from('campaigns').select('*').order('event_date', { ascending: false })).then(setCampaigns)
  useEffect(() => { void loadCampaigns() }, [])
  useEffect(() => { if (cfg) { setRanges(cfg.ranges); setGroups(cfg.groups) } }, [cfg])
  if (!cfg) return <p className="muted">Cargando…</p>

  const done = (error: { message: string } | null, ok: string) => { if (error) toast.show('err', errorMessage(error)); else { toast.show('ok', ok); void refresh(); void loadCampaigns() } }

  async function saveRange(r: Range) {
    const { error } = await supabase.rpc('update_range', { p_variable: r.variable, p_hard_min: r.hard_min, p_hard_max: r.hard_max, p_warn_min: r.warn_min, p_warn_max: r.warn_max })
    done(error, 'Rango actualizado')
  }
  async function saveGroup(g: Group) {
    const { error } = await supabase.from('groups').update({ range_start: g.range_start, range_end: g.range_end }).eq('id', g.id)
    done(error, `Grupo ${g.code} actualizado`)
  }
  async function newCampaign() {
    const name = prompt('Nombre de la nueva campaña:'); if (!name) return
    const date = prompt('Fecha (aaaa-mm-dd):', new Date().toISOString().slice(0, 10)); if (!date) return
    if (!confirm('La nueva campaña quedará activa y la actual pasará a inactiva (sus datos se conservan). ¿Continuar?')) return
    await supabase.from('campaigns').update({ is_active: false }).eq('is_active', true)
    const { data, error } = await supabase.from('campaigns').insert({ name, event_date: date, is_active: true }).select().single()
    if (error) return done(error, '')
    const gs = ['A', 'B', 'C', 'D', 'E'].map((code, i) => ({ campaign_id: data.id, code, range_start: i * 100 + 1, range_end: (i + 1) * 100 }))
    const { error: ge } = await supabase.from('groups').insert(gs)
    done(ge, 'Campaña creada con grupos A–E. Reasigne los evaluadores a los nuevos grupos.')
  }
  async function activate(c: Campaign) {
    if (!confirm(`¿Activar «${c.name}»?`)) return
    await supabase.from('campaigns').update({ is_active: false }).eq('is_active', true)
    const { error } = await supabase.from('campaigns').update({ is_active: true }).eq('id', c.id)
    done(error, 'Campaña activada')
  }
  async function addGroup() {
    const code = prompt('Código del nuevo grupo (p. ej. F):')?.toUpperCase(); if (!code) return
    const max = Math.max(0, ...groups.map((g) => g.range_end))
    const { error } = await supabase.from('groups').insert({ campaign_id: cfg!.campaign!.id, code, range_start: max + 1, range_end: max + 100 })
    done(error, `Grupo ${code} creado`)
  }

  const numField = (val: number, set: (n: number) => void) => <input type="number" step="any" value={val} onChange={(e) => set(Number(e.target.value))} style={{ width: 90 }} />

  return (
    <>
      {toast.node}
      <h1>Configuración</h1>
      <div className="card">
        <div className="row"><h2 className="grow">Campañas</h2><button onClick={() => void newCampaign()}>+ Nueva campaña</button></div>
        <table><tbody>{campaigns.map((c) => (
          <tr key={c.id}><td>{c.name}</td><td>{c.event_date}</td>
            <td>{c.is_active ? <span className="badge ok">Activa</span> : <button onClick={() => void activate(c)}>Activar</button>}</td></tr>))}</tbody></table>
      </div>

      <div className="card">
        <div className="row"><h2 className="grow">Grupos y rangos de numeración</h2>{cfg.campaign && <button onClick={() => void addGroup()}>+ Grupo</button>}</div>
        <p className="muted">El rango solo define la numeración automática; los números ya asignados se conservan.</p>
        <table><thead><tr><th>Grupo</th><th>Desde</th><th>Hasta</th><th /></tr></thead>
          <tbody>{groups.map((g, i) => (
            <tr key={g.id}><td><strong>{g.code}</strong></td>
              <td>{numField(g.range_start, (n) => setGroups(groups.map((x, j) => j === i ? { ...x, range_start: n } : x)))}</td>
              <td>{numField(g.range_end, (n) => setGroups(groups.map((x, j) => j === i ? { ...x, range_end: n } : x)))}</td>
              <td><button onClick={() => void saveGroup(g)}>Guardar</button> <small className="muted">{pad(g.range_start)}–{pad(g.range_end)}</small></td></tr>))}</tbody></table>
      </div>

      <div className="card">
        <h2>Rangos de plausibilidad</h2>
        <p className="muted">Fuera del rango <strong>admisible</strong> el valor se rechaza (error evidente de digitación o unidad). Fuera del rango <strong>habitual</strong> se pide confirmación y el valor queda marcado como inusual. Ajústelos según el protocolo validado.</p>
        <div className="table-wrap"><table><thead><tr><th>Variable</th><th>Admisible mín.</th><th>Habitual mín.</th><th>Habitual máx.</th><th>Admisible máx.</th><th /></tr></thead>
          <tbody>{ranges.map((r, i) => {
            const set = (k: keyof Range) => (n: number) => setRanges(ranges.map((x, j) => j === i ? { ...x, [k]: n } : x))
            return <tr key={r.variable}><td>{VARIABLES.find((v) => v.key === r.variable)!.label} ({r.unit})</td>
              <td>{numField(r.hard_min, set('hard_min'))}</td><td>{numField(r.warn_min, set('warn_min'))}</td>
              <td>{numField(r.warn_max, set('warn_max'))}</td><td>{numField(r.hard_max, set('hard_max'))}</td>
              <td><button onClick={() => void saveRange(r)}>Guardar</button></td></tr>
          })}</tbody></table></div>
      </div>
      <div className="card">
        <h2>Autorizadores</h2>
        <p>Los autorizadores son los administradores con el permiso «Resolver solicitudes». Actívelo o desactívelo desde <Link to="/usuarios">Usuarios</Link>. Actualmente: <strong>{cfg.profiles.filter((p) => p.status === 'activa' && p.role === 'admin' && p.can_resolve_requests).map((p) => p.display_name).join(', ') || 'ninguno'}</strong> (además de la cuenta principal).</p>
      </div>
    </>
  )
}
