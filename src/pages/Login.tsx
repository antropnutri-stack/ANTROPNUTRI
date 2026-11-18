import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/supabase'
import { Mascot } from '../components/Mascot'

export default function Login() {
  const { signIn } = useAuth()
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try { await signIn(code, password) } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <div className="login">
      <div className="card">
        <Mascot size={150} />
        <p className="title-big">ANTROPNUTRI</p>
        <p className="muted">Sistema inteligente de evaluación antropométrica</p>
        <form onSubmit={submit}>
          {error && <div className="alert err">{error}</div>}
          <div className="field">
            <label htmlFor="code">Usuario</label>
            <input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Su primer nombre"
              autoCapitalize="characters" autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="pw">Contraseña</label>
            <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <button className="primary big" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
        <p className="muted" style={{ marginTop: '1rem', fontSize: '.8rem' }}>Cuenta personal e intransferible. No comparta su contraseña.</p>
      </div>
    </div>
  )
}
