import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key)
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})

export const LOGIN_DOMAIN = (import.meta.env.VITE_LOGIN_DOMAIN as string | undefined) ?? 'antropnutri.local'
export const codeToEmail = (code: string) => `${code.trim().toLowerCase()}@${LOGIN_DOMAIN}`

/** Convierte errores de las funciones SQL («CODIGO: detalle») en mensajes legibles. */
export function errorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e)
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sin conexión con el servidor.'
  if (msg === 'Invalid login credentials') return 'Código o contraseña incorrectos.'
  const m = msg.match(/^[A-ZÑ_]+: (.*)$/)
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : msg
}
