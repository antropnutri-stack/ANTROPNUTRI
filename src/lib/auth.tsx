import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, codeToEmail } from './supabase'
import type { PermKey, Profile } from './types'
import { initQueue } from './offlineQueue'

interface AuthCtx {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (code: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  can: (perm: PermKey) => boolean
  isAdmin: boolean
  reload: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); setLoading(false); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setProfile((data as Profile) ?? null)
    if (data) initQueue(s.user.id)
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); void loadProfile(data.session) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); void loadProfile(s) })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const signIn = async (code: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: codeToEmail(code), password })
    if (error) throw error
  }
  const signOut = async () => { await supabase.auth.signOut() }

  const isAdmin = !!profile && profile.status === 'activa' && (profile.role === 'principal' || profile.role === 'admin')
  const can = (perm: PermKey) => {
    if (!profile || profile.status !== 'activa') return false
    if (profile.role === 'principal') return true
    if (profile.role === 'evaluador') return false
    return profile[perm]
  }

  return (
    <Ctx.Provider value={{ session, profile, loading, signIn, signOut, can, isAdmin, reload: () => loadProfile(session) }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth fuera de AuthProvider')
  return c
}
