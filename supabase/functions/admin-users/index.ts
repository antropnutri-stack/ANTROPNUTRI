// Supabase Edge Function: creación de cuentas y cambio de contraseñas.
// Requiere la clave service_role (disponible automáticamente en el entorno de Edge Functions).
// Despliegue: supabase functions deploy admin-users
import { createClient } from 'npm:@supabase/supabase-js@2.75.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const LOGIN_DOMAIN = Deno.env.get('LOGIN_DOMAIN') ?? 'antropnutri.local'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: { user } } = await admin.auth.getUser(token)
    if (!user) return json({ error: 'No autenticado' }, 401)
    const { data: caller } = await admin.from('profiles').select('*').eq('id', user.id).single()
    if (!caller || caller.status !== 'activa' || caller.role === 'evaluador') return json({ error: 'No autorizado' }, 403)

    const body = await req.json()
    const isPrincipal = caller.role === 'principal'
    const canEvaluators = isPrincipal || caller.can_create_evaluators

    if (body.action === 'create') {
      const role = body.role as 'admin' | 'evaluador'
      if (role === 'admin' && !isPrincipal) return json({ error: 'Solo el administrador principal crea administradores' }, 403)
      if (role === 'evaluador' && !canEvaluators) return json({ error: 'Sin permiso para crear evaluadores' }, 403)
      if (!['admin', 'evaluador'].includes(role)) return json({ error: 'Rol inválido' }, 400)
      const code = String(body.code ?? '').trim().toUpperCase()
      if (!/^[A-Z0-9-]{3,20}$/.test(code)) return json({ error: 'Código inválido (use letras, números y guiones)' }, 400)
      if (String(body.password ?? '').length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400)

      const { data: created, error } = await admin.auth.admin.createUser({
        email: `${code.toLowerCase()}@${LOGIN_DOMAIN}`, password: body.password, email_confirm: true,
        user_metadata: { code },
      })
      if (error) return json({ error: error.message.includes('already') ? 'Ese código ya existe' : error.message }, 400)

      const perms = isPrincipal && role === 'admin' ? (body.perms ?? {}) : {}
      const { error: pe } = await admin.from('profiles').insert({
        id: created.user.id, code, full_name: body.full_name, display_name: body.display_name, role,
        group_id: body.group_id || null, station: body.station || null, ...perms,
      })
      if (pe) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: pe.message }, 400) }
      await admin.from('audit_log').insert({ actor_id: caller.id, action: 'cuenta_creada', entity: 'profile', entity_id: created.user.id, details: { code, role } })
      return json({ id: created.user.id })
    }

    if (body.action === 'reset_password') {
      const { data: target } = await admin.from('profiles').select('role').eq('id', body.id).single()
      if (!target) return json({ error: 'No encontrado' }, 404)
      if (target.role !== 'evaluador' && !isPrincipal) return json({ error: 'No autorizado' }, 403)
      if (target.role === 'evaluador' && !canEvaluators) return json({ error: 'No autorizado' }, 403)
      if (String(body.password ?? '').length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400)
      const { error } = await admin.auth.admin.updateUserById(body.id, { password: body.password })
      if (error) return json({ error: error.message }, 400)
      await admin.from('audit_log').insert({ actor_id: caller.id, action: 'contraseña_restablecida', entity: 'profile', entity_id: body.id, details: {} })
      return json({ ok: true })
    }
    return json({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
