import { useState, type FormEvent } from 'react'
import { useAuth } from '../../lib/auth'
import { useConfig, type Config } from '../../lib/hooks'
import { supabase, errorMessage, normalize } from '../../lib/supabase'
import { PERMS, type PermKey, type Profile, type Role, type Station } from '../../lib/types'
import { Modal, useToast } from '../../components/ui'

const ROLE_LABEL: Record<Role, string> = { principal: 'Principal', admin: 'Administrador', evaluador: 'Evaluador' }

export default function Users() {
  const { data: cfg, refresh } = useConfig()
  const { profile: me, can } = useAuth()
  const [editing, setEditing] = useState<Profile | 'new-evaluador' | 'new-admin' | null>(null)
  const [filter, setFilter] = useState<Role | ''>('')
  if (!cfg || !me) return <p className="muted">Cargando…</p>
  const isPrincipal = me.role === 'principal'
  const list = cfg.profiles.filter((p) => !filter || p.role === filter)

  return (
    <>
      <div className="row"><h1 className="grow">Usuarios</h1>
        <select style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as Role)}>
          <option value="">Todos</option><option value="evaluador">Evaluadores</option><option value="admin">Administradores</option></select>
        {can('can_create_evaluators') && <button className="primary" onClick={() => setEditing('new-evaluador')}>+ Evaluador</button>}
        {isPrincipal && <button className="primary" onClick={() => setEditing('new-admin')}>+ Administrador</button>}
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Usuario</th><th>Nombre visible</th><th>Nombre completo</th><th>Rol</th><th>Promoción</th><th>Permisos</th><th>Estado</th></tr></thead>
          <tbody>{list.map((p) => {
            const editable = p.id === me.id || (p.role === 'evaluador' && can('can_create_evaluators')) || (p.role === 'admin' && isPrincipal)
            return (
              <tr key={p.id} className={editable ? 'clickable' : ''} onClick={() => editable && setEditing(p)}>
                <td><strong>{p.code}</strong></td><td>{p.display_name}</td><td>{p.full_name}</td><td>{ROLE_LABEL[p.role]}</td>
                <td>{cfg.groups.find((g) => g.id === p.group_id)?.code ?? '—'}</td>
                <td>{p.role === 'evaluador' ? 'Todas las mediciones'
                  : p.role === 'principal' ? 'Todos' : PERMS.filter(([k]) => p[k]).map(([, l]) => l).join(', ') || '—'}</td>
                <td><span className={`badge ${p.status === 'activa' ? 'ok' : p.status === 'suspendida' ? 'warn' : 'err'}`}>{p.status}</span></td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '.85rem' }}>Cada persona usa su propia cuenta. Las contraseñas nunca se guardan en hojas de cálculo: entréguelas personalmente y pida cambiarlas si es posible.</p>
      {editing && <UserForm cfg={cfg} target={editing} isPrincipal={isPrincipal} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh() }} />}
    </>
  )
}

function nextCode(profiles: Profile[], prefix: string) {
  const n = Math.max(0, ...profiles.map((p) => p.code.startsWith(prefix) ? parseInt(p.code.slice(prefix.length), 10) || 0 : 0))
  return `${prefix}${String(n + 1).padStart(3, '0')}`
}

function UserForm({ cfg, target, isPrincipal, onClose, onSaved }: {
  cfg: Config; target: Profile | 'new-evaluador' | 'new-admin'; isPrincipal: boolean; onClose: () => void; onSaved: () => void
}) {
  const isNew = typeof target === 'string'
  const role: Role = isNew ? (target === 'new-admin' ? 'admin' : 'evaluador') : target.role
  const init = isNew ? null : target
  const [f, setF] = useState({
    code: init?.code ?? nextCode(cfg.profiles, role === 'admin' ? 'ADM-' : 'NUT'),
    full_name: init?.full_name ?? '', display_name: init?.display_name ?? '',
    group_id: init?.group_id ?? '', station: (init?.station ?? '') as Station | '', status: init?.status ?? 'activa',
    password: '',
  })
  const [perms, setPerms] = useState<Record<PermKey, boolean>>(Object.fromEntries(PERMS.map(([k]) => [k, init?.[k] ?? false])) as Record<PermKey, boolean>)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      if (isNew) {
        const { data, error } = await supabase.functions.invoke('admin-users', {
          body: { action: 'create', role, code: f.code, password: normalize(f.password), full_name: f.full_name, display_name: f.display_name,
            group_id: f.group_id || null, station: f.station || null, perms: role === 'admin' ? perms : undefined },
        })
        if (error) throw new Error((await error.context?.json?.())?.error ?? error.message)
        if (data?.error) throw new Error(data.error)
      } else {
        const { error } = await supabase.rpc('update_profile', {
          p_id: init!.id, p_full_name: f.full_name, p_display_name: f.display_name, p_group_id: f.group_id || null,
          p_station: f.station || null, p_status: f.status, p_perms: isPrincipal && role === 'admin' ? perms : null,
        })
        if (error) throw error
      }
      onSaved()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  async function resetPassword() {
    const pw = prompt('Nueva contraseña (mínimo 3 caracteres):')
    if (!pw) return
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'reset_password', id: init!.id, password: normalize(pw) } })
    if (error || data?.error) toast.show('err', data?.error ?? (await error?.context?.json?.())?.error ?? error?.message)
    else toast.show('ok', 'Contraseña actualizada.')
  }

  return (
    <Modal title={isNew ? `Nuevo ${role === 'admin' ? 'administrador' : 'evaluador'}` : `Editar ${init!.code}`} onClose={onClose}>
      {toast.node}
      <form onSubmit={submit}>
        {error && <div className="alert err">{error}</div>}
        <div className="row">
          <div className="field grow"><label>Usuario (ID)</label>
            <input value={f.code} disabled={!isNew} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required pattern="[A-Z0-9\-]{2,20}" /></div>
          {isNew && <div className="field grow"><label>Contraseña inicial</label>
            <input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={3} autoComplete="new-password" /></div>}
        </div>
        <div className="field"><label>Nombre completo real</label><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required /></div>
        <div className="field"><label>Nombre visible</label><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value.toUpperCase() })} required placeholder="NUT. DRAKE" />
          <small>Use «NUT.» solo si corresponde a la acreditación profesional.</small></div>
        <div className="row">
          <div className="field grow"><label>Promoción (opcional)</label>
            <select value={f.group_id} onChange={(e) => setF({ ...f, group_id: e.target.value })}>
              <option value="">—</option>{cfg.groups.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}</select></div>
        </div>
        {!isNew && <div className="field"><label>Estado de la cuenta</label>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'activa' })}>
            <option value="activa">Activa</option><option value="suspendida">Suspendida</option><option value="desactivada">Desactivada</option></select></div>}
        {role === 'admin' && isPrincipal && (
          <div className="field"><label>Permisos</label>
            {PERMS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />{l}</label>)}
          </div>
        )}
        <div className="row">
          <button className="primary grow" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          {!isNew && <button type="button" onClick={() => void resetPassword()}>Restablecer contraseña</button>}
          <button type="button" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </Modal>
  )
}
