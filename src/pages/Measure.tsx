import { useConfig } from '../lib/hooks'
import { VARIABLES } from '../lib/types'
import { MeasureForm } from '../components/MeasureForm'

export default function Measure() {
  const { data: cfg } = useConfig()
  if (!cfg) return <p className="muted">Cargando…</p>
  return (
    <div className="narrow" style={{ maxWidth: 720 }}>
      <h1>Registrar medición</h1>
      <p className="muted">Registro administrativo: puede ingresar cualquiera de las cinco mediciones. Quedará identificado como responsable.</p>
      <MeasureForm campaignId={cfg.campaign?.id ?? ''} variables={VARIABLES.map((v) => v.key)} ranges={cfg.ranges} profiles={cfg.profiles}
        groupCode={(id) => cfg.groups.find((g) => g.id === id)?.code ?? '?'} />
    </div>
  )
}
