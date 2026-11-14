import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { isConfigured } from './lib/supabase'
import Login from './pages/Login'
import Layout from './components/Layout'
import EvaluatorHome from './pages/EvaluatorHome'
import AdminDashboard from './pages/admin/Dashboard'
import Participants from './pages/admin/Participants'
import ImportParticipants from './pages/admin/ImportParticipants'
import Users from './pages/admin/Users'
import Requests from './pages/admin/Requests'
import Quality from './pages/admin/Quality'
import Settings from './pages/admin/Settings'
import Exports from './pages/admin/Exports'
import Audit from './pages/admin/Audit'
import Measure from './pages/Measure'

export default function App() {
  const { session, profile, loading, isAdmin, signOut } = useAuth()
  if (!isConfigured) {
    return <main className="narrow"><div className="card"><h1>Configuración pendiente</h1>
      <p>Defina <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en <code>.env.local</code> (vea el README).</p></div></main>
  }
  if (loading) return <main className="narrow"><p className="muted">Cargando…</p></main>
  if (!session) return <Login />
  if (!profile || profile.status !== 'activa') {
    return <main className="narrow"><div className="card"><h1>Cuenta no disponible</h1>
      <p>{profile ? `Su cuenta está ${profile.status}.` : 'Esta cuenta no tiene un perfil asignado en ANTROPNUTRI.'} Comuníquese con la administración.</p>
      <button onClick={signOut}>Cerrar sesión</button></div></main>
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        {isAdmin ? (
          <>
            <Route path="/" element={<AdminDashboard />} />
            <Route path="/participantes" element={<Participants />} />
            <Route path="/importar" element={<ImportParticipants />} />
            <Route path="/usuarios" element={<Users />} />
            <Route path="/solicitudes" element={<Requests />} />
            <Route path="/calidad" element={<Quality />} />
            <Route path="/configuracion" element={<Settings />} />
            <Route path="/exportar" element={<Exports />} />
            <Route path="/auditoria" element={<Audit />} />
            <Route path="/medir" element={<Measure />} />
          </>
        ) : (
          <Route path="/" element={<EvaluatorHome />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
