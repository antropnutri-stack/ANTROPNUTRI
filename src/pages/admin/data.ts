import { fetchAll, useConfig, useLive } from '../../lib/hooks'
import type { Measurement, ParticipantResult, SupportRequest } from '../../lib/types'

/** Datos operativos de la jornada, actualizados en tiempo real. */
export function useOperations() {
  const { data: cfg } = useConfig()
  const campaignId = cfg?.campaign?.id
  return useLive(async () => {
    if (!campaignId) return { results: [], measurements: [], requests: [] }
    const [all, measurements, requests] = await Promise.all([
      fetchAll<ParticipantResult>('participant_results', 'number'),
      fetchAll<Measurement>('measurements'),
      fetchAll<SupportRequest>('support_requests', 'created_at'),
    ])
    // Solo la campaña activa (las anteriores se conservan en la base de datos)
    const results = all.filter((r) => r.campaign_id === campaignId)
    const ids = new Set(results.map((r) => r.id))
    return {
      results,
      measurements: measurements.filter((m) => ids.has(m.participant_id)),
      requests: requests.filter((r) => ids.has(r.participant_id)),
    }
  }, ['participants', 'measurements', 'support_requests'], [campaignId])
}
