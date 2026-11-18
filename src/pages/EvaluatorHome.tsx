import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { fetchAll, useConfig, useLive, useQueue } from '../lib/hooks'
import { discardOp, retryOp } from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'
import { N_VARS, VARIABLES, pad, varLabel, type Participant } from '../lib/types'
import { MeasureForm, cacheParticipants } from '../components/MeasureForm'
import { RegisterParticipant } from '../components/RegisterParticipant'
import { Modal, Stat } from '../components/ui'

// Pantalla liviana del evaluador: no descarga las mediciones de todos (ahorro de datos móviles).
export default function EvaluatorHome() {
  const { profile } = useAuth()
  const { data: cfg } = useConfig()
  const [registering, setRegistering] = useState(false)
  const queue = useQueue()

  // Resumen pequeño, cada 60 s y solo con la pantalla visible (sin tiempo real)
  const { data, refresh } = useLive(async () => {
    const [participants, mine] = await Promise.all([
      fetchAll<Participant>('participants', 'number', 'id,campaign_id,number,full_name,dni,age,birth_date,sex,group_id,needs_review,review_note,created_by'),
      supabase.from('measurements').select('id', { count: 'exact', head: true }).eq('evaluator_id', profile!.id),
    ])
    cacheParticipants(participants) // para buscar sin conexión
    return { participants, mine: mine.count ?? 0 }
  }, [], [], 60000)

  if (!cfg || !profile) return <p className="muted">Cargando…</p>
  const campaignId = cfg.campaign?.id
  const groupCode = (id: string) => cfg.groups.find((g) => g.id === id)?.code ?? '?'
  const total = data?.participants.filter((p) => p.campaign_id === campaignId).length ?? 0

  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      <h1>Bienvenido, {profile.display_name}</h1>
      <p className="muted">Busque al participante y registre cualquiera de las {N_VARS} medidas.</p>

      <div className="stats">
        <Stat label="Mis registros" value={data?.mine ?? '—'} />
        <Stat label="Participantes registrados" value={data ? total : '—'} />
      </div>

      <QueuePanel queue={queue} />

      <MeasureForm campaignId={campaignId ?? ''} variables={VARIABLES.map((v) => v.key)} ranges={cfg.ranges} profiles={cfg.profiles}
        groupCode={groupCode} />

      <div className="row" style={{ marginBottom: '1rem' }}>
        <button className="big" onClick={() => setRegistering(true)}>+ Registrar participante</button>
      </div>

      {registering && (
        <Modal title="Registrar participante" onClose={() => { setRegistering(false); void refresh() }}>
          <RegisterParticipant groups={cfg.groups} />
        </Modal>
      )}
    </div>
  )
}

function QueuePanel({ queue }: { queue: ReturnType<typeof useQueue> }) {
  const errs = queue.filter((o) => o.state === 'error')
  const pend = queue.filter((o) => o.state === 'pendiente')
  if (!queue.length) return null
  return (
    <div className="card">
      <h3>Sincronización</h3>
      {pend.length > 0 && <div className="alert warn">{pend.length} medición(es) guardadas en este dispositivo, pendientes de enviar. No cierre la sesión ni borre los datos del navegador.</div>}
      {errs.map((o) => (
        <div key={o.id} className="alert err">
          <strong>{pad(o.number)} · {varLabel(o.variable)}: {o.value}</strong><br />{o.error}
          <div className="row" style={{ marginTop: '.4rem' }}>
            <button onClick={() => retryOp(o.id)}>Reintentar</button>
            <button onClick={() => confirm('¿Descartar este registro local? No se enviará al servidor.') && discardOp(o.id)}>Descartar</button>
          </div>
        </div>
      ))}
    </div>
  )
}
