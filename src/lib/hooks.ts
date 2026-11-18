import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { getQueue, subscribeQueue } from './offlineQueue'
import type { Campaign, Group, Profile, Range } from './types'

/**
 * Ejecuta `load` y lo repite cuando cambian las tablas indicadas, con dos frenos para
 * ahorrar datos móviles: como máximo una recarga cada `minIntervalMs` y nunca con la
 * pantalla oculta (al volver a la app se pone al día). `tables` vacío = solo sondeo.
 */
export function useLive<T>(load: () => Promise<T>, tables: string[], deps: unknown[] = [], minIntervalMs = 30000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const last = useRef(0)
  const dirty = useRef(false)

  const refresh = useCallback(async () => {
    last.current = Date.now(); dirty.current = false
    try { setData(await loadRef.current()); setError(null) } catch (e) { setError((e as Error).message) }
  }, [])

  useEffect(() => {
    void refresh()
    const schedule = () => {
      dirty.current = true
      if (document.hidden || timer.current) return
      const wait = Math.max(400, minIntervalMs - (Date.now() - last.current))
      timer.current = setTimeout(() => { timer.current = undefined; if (!document.hidden) void refresh() }, wait)
    }
    let ch: ReturnType<typeof supabase.channel> | null = null
    if (tables.length) {
      ch = supabase.channel(`live-${tables.join('-')}-${Math.random().toString(36).slice(2)}`)
      for (const t of tables) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, schedule)
      ch.subscribe()
    }
    const onVisible = () => { if (!document.hidden && (dirty.current || Date.now() - last.current > minIntervalMs)) void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    // Respaldo: sondeo periódico solo con la pantalla visible
    const poll = setInterval(() => { if (!document.hidden) void refresh() }, Math.max(60000, minIntervalMs * 2))
    return () => {
      clearInterval(poll); clearTimeout(timer.current); timer.current = undefined
      document.removeEventListener('visibilitychange', onVisible)
      if (ch) void supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, ...deps])

  return { data, error, refresh }
}

async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as T
}
export { q }

export interface Config { campaign: Campaign | null; groups: Group[]; ranges: Range[]; profiles: Profile[] }

export function useConfig() {
  return useLive<Config>(async () => {
    const [campaigns, groups, ranges, profiles] = await Promise.all([
      q<Campaign[]>(supabase.from('campaigns').select('*').eq('is_active', true)),
      q<Group[]>(supabase.from('groups').select('*').order('code')),
      q<Range[]>(supabase.from('plausibility_ranges').select('*')),
      q<Profile[]>(supabase.from('profiles').select('*').order('code')),
    ])
    const campaign = campaigns[0] ?? null
    return { campaign, groups: groups.filter((g) => g.campaign_id === campaign?.id), ranges, profiles }
  }, ['profiles', 'groups'])
}

export function useQueue() {
  return useSyncExternalStore(subscribeQueue, getQueue)
}

export function useOnline() {
  return useSyncExternalStore(
    (cb) => { window.addEventListener('online', cb); window.addEventListener('offline', cb); return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) } },
    () => navigator.onLine,
  )
}

/** Lee todas las filas superando el límite de 1000 filas por petición de PostgREST. */
export async function fetchAll<T>(table: string, order = 'id', select = '*'): Promise<T[]> {
  const out: T[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(select).order(order).range(from, from + size - 1)
    if (error) throw new Error(error.message)
    out.push(...(data as T[]))
    if (!data || data.length < size) return out
  }
}
