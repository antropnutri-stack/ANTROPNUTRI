// Cola local de mediciones pendientes de sincronización.
// Cada operación lleva un client_op_id: si se reenvía, el servidor no la duplica.
import { supabase, errorMessage } from './supabase'
import type { Variable } from './types'

export type SyncState = 'guardado' | 'pendiente' | 'error'

export interface QueuedOp {
  id: string // client_op_id
  number: number
  variable: Variable
  value: number
  confirmUnusual: boolean
  recordedAt: string
  state: 'pendiente' | 'error'
  error?: string
  attempts: number
}

export type SaveResult =
  | { status: 'guardado' | 'ya_guardado'; id: string; unusual?: boolean }
  | { status: 'ya_existe'; id: string; value: number; evaluator_id: string }
  | { status: 'requiere_confirmacion'; warn_min: number; warn_max: number; unit: string }

const key = (uid: string) => `antropnutri.queue.${uid}`
let uid = ''
let ops: QueuedOp[] = []
const listeners = new Set<() => void>()
let syncing = false

function persist() {
  try { localStorage.setItem(key(uid), JSON.stringify(ops)) } catch { /* almacenamiento lleno o bloqueado */ }
  listeners.forEach((l) => l())
}

export function initQueue(userId: string) {
  uid = userId
  try { ops = JSON.parse(localStorage.getItem(key(uid)) ?? '[]') } catch { ops = [] }
  listeners.forEach((l) => l())
  void syncQueue()
}

export const getQueue = () => ops
export function subscribeQueue(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }

const isNetworkError = (e: unknown) => /Failed to fetch|NetworkError|network|Load failed|fetch/i.test(errorMessage(e) + String((e as Error)?.message ?? ''))

async function send(op: Pick<QueuedOp, 'id' | 'number' | 'variable' | 'value' | 'confirmUnusual' | 'recordedAt'>): Promise<SaveResult> {
  const { data, error } = await supabase.rpc('save_measurement', {
    p_participant_number: op.number, p_variable: op.variable, p_value: op.value,
    p_confirm_unusual: op.confirmUnusual, p_client_op_id: op.id, p_recorded_at: op.recordedAt,
  })
  if (error) throw error
  return data as SaveResult
}

/**
 * Guarda una medición. Si no hay conexión, la deja en cola y devuelve 'pendiente'.
 * Errores de validación del servidor se lanzan para mostrarlos al evaluador.
 */
export async function saveMeasurement(input: { number: number; variable: Variable; value: number; confirmUnusual: boolean }):
  Promise<{ sync: SyncState; result?: SaveResult }> {
  const op = { ...input, id: crypto.randomUUID(), recordedAt: new Date().toISOString() }
  if (!navigator.onLine) { enqueue(op); return { sync: 'pendiente' } }
  try {
    const result = await send(op)
    return { sync: 'guardado', result }
  } catch (e) {
    if (isNetworkError(e)) { enqueue(op); return { sync: 'pendiente' } }
    throw e
  }
}

function enqueue(op: Omit<QueuedOp, 'state' | 'attempts'>) {
  ops = [...ops, { ...op, state: 'pendiente', attempts: 0 }]
  persist()
}

export async function syncQueue() {
  if (syncing || !navigator.onLine || !ops.some((o) => o.state === 'pendiente')) return
  syncing = true
  try {
    for (const op of ops.filter((o) => o.state === 'pendiente')) {
      try {
        const r = await send(op)
        if (r.status === 'guardado' || r.status === 'ya_guardado') {
          ops = ops.filter((o) => o.id !== op.id)
        } else if (r.status === 'ya_existe') {
          ops = ops.map((o) => o.id === op.id ? { ...o, state: 'error', error: `Ya existe un valor registrado (${r.value}). Requiere revisión de un administrador.` } : o)
        } else {
          ops = ops.map((o) => o.id === op.id ? { ...o, state: 'error', error: 'El servidor solicita confirmar el valor inusual.' } : o)
        }
      } catch (e) {
        if (isNetworkError(e)) { ops = ops.map((o) => o.id === op.id ? { ...o, attempts: o.attempts + 1 } : o); break }
        ops = ops.map((o) => o.id === op.id ? { ...o, state: 'error', error: errorMessage(e) } : o)
      }
      persist()
    }
  } finally {
    syncing = false
    persist()
  }
}

export function retryOp(id: string) {
  ops = ops.map((o) => o.id === id ? { ...o, state: 'pendiente', error: undefined, confirmUnusual: true } : o)
  persist(); void syncQueue()
}
export function discardOp(id: string) { ops = ops.filter((o) => o.id !== id); persist() }

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void syncQueue())
  setInterval(() => void syncQueue(), 15000)
}
