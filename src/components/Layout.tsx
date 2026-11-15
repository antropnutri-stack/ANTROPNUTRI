import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useLive, useOnline, useQueue } from '../lib/hooks'
import { supabase } from '../lib/supabase'

export default function Layout() {
  const { profile, isAdmin, can, signOut } = useAuth()
  const online = useOnline()
  const queue = useQueue()
  const pending = queue.filter((o) => o.state === 'pendiente').length
  const errors = queue.filter((o) => o.state === 'error').length
  const { data: openRequests } = useLive(async () => {
    if (!isAdmin) return 0
    const { count } = await supabase.from('support_requests').select('id', { count: 'exact', head: true }).eq('status', 'pendiente')
    return count ?? 0
  }, ['support_requests'])

  const sync = errors ? { cls: 'err', text: `${errors} con error` }
    : !online ? { cls: 'warn', text: `Sin conexión${pending ? ` · ${pending} pendientes` : ''}` }
    : pending ? { cls: 'warn', text: `${pending} pendientes de sincronizar` }
    : { cls: 'ok', text: 'Sincronizado' }

  return (
    <>
      <header className="topbar">
        <span className="brand"><img src={`${import.meta.env.BASE_URL}nutria.svg`} alt="" /><span className="txt">ANTROPNUTRI</span></span>
        <span className="spacer" />
        <span className={`sync ${sync.cls}`} title="Estado de sincronización">{sync.text}</span>
        <span className="who">{profile?.display_name}</span>
        <button onClick={signOut}>Salir</button>
      </header>
      {isAdmin && (
        <nav className="subnav">
          <NavLink to="/" end>Panel</NavLink>
          <NavLink to="/participantes">Participantes</NavLink>
          <NavLink to="/solicitudes">Solicitudes{!!openRequests && <span className="badge err">{openRequests}</span>}</NavLink>
          <NavLink to="/calidad">Calidad</NavLink>
          {can('can_register_measurements') && <NavLink to="/medir">Registrar medición</NavLink>}
          {can('can_manage_participants') && <NavLink to="/importar">Importar Excel</NavLink>}
          {(can('can_create_evaluators') || profile?.role === 'principal') && <NavLink to="/usuarios">Usuarios</NavLink>}
          {can('can_export') && <NavLink to="/exportar">Exportar</NavLink>}
          {can('can_view_audit') && <NavLink to="/auditoria">Auditoría</NavLink>}
          {profile?.role === 'principal' && <NavLink to="/configuracion">Configuración</NavLink>}
        </nav>
      )}
      <main><Outlet /></main>
    </>
  )
}
