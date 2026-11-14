import { useEffect, useState, type ReactNode } from 'react'

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function useToast() {
  const [t, setT] = useState<{ kind: 'ok' | 'warn' | 'err' | 'info'; text: string } | null>(null)
  useEffect(() => { if (t) { const id = setTimeout(() => setT(null), 3500); return () => clearTimeout(id) } }, [t])
  const node = t ? <div className={`alert ${t.kind} toast`} role="status">{t.text}</div> : null
  return { show: (kind: 'ok' | 'warn' | 'err' | 'info', text: string) => setT({ kind, text }), node }
}

export function Bar({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0
  return <div className="bar" aria-label={`${pct}%`}><span style={{ width: `${pct}%` }} /></div>
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="stat"><div className="label">{label}</div><div className="value">{value}</div></div>
}

export function StatusBadge({ estado }: { estado: string }) {
  const map: Record<string, [string, string]> = {
    sin_iniciar: ['', 'Sin iniciar'], en_proceso: ['info', 'En proceso'], completo: ['ok', 'Completo'],
    requiere_revision: ['err', 'Requiere revisión'], pendiente: ['warn', 'Pendiente'], aprobada: ['info', 'Aprobada'],
    rechazada: ['err', 'Rechazada'], cancelada: ['', 'Cancelada'], finalizada: ['ok', 'Finalizada'],
  }
  const [cls, text] = map[estado] ?? ['', estado]
  return <span className={`badge ${cls}`}>{text}</span>
}
