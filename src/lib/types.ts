export type Role = 'principal' | 'admin' | 'evaluador'
export type AccountStatus = 'activa' | 'suspendida' | 'desactivada'
export type Station = 'registro' | 'peso' | 'talla' | 'cintura' | 'brazo' | 'supervision'
export type Variable = 'peso' | 'talla' | 'cintura' | 'perimetro_braquial' | 'pliegue_tricipital'
export type RequestType = 'apoyo_temporal' | 'apoyo_varias' | 'traslado' | 'remedicion'
export type RequestStatus = 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada' | 'finalizada'
export type EvalStatus = 'sin_iniciar' | 'en_proceso' | 'completo' | 'requiere_revision'

export const PERMS = [
  ['can_register_measurements', 'Registrar mediciones'],
  ['can_create_evaluators', 'Crear y editar evaluadores'],
  ['can_manage_participants', 'Gestionar participantes y corregir datos'],
  ['can_resolve_requests', 'Resolver solicitudes (autorizador)'],
  ['can_change_group', 'Cambiar grupo de participante'],
  ['can_export', 'Exportar base completa'],
  ['can_view_audit', 'Consultar auditoría'],
] as const
export type PermKey = (typeof PERMS)[number][0]

export interface Profile extends Record<PermKey, boolean> {
  id: string
  code: string
  full_name: string
  display_name: string
  role: Role
  group_id: string | null
  station: Station | null
  status: AccountStatus
  created_at: string
}

export interface Group { id: string; campaign_id: string; code: string; range_start: number; range_end: number }
export interface Campaign { id: string; name: string; event_date: string; is_active: boolean }

export interface Participant {
  id: string; campaign_id: string; number: number; full_name: string; birth_date: string | null; age: number | null
  sex: 'M' | 'F'; group_id: string; needs_review: boolean; review_note: string | null; created_by: string | null
}

export interface Measurement {
  id: string; participant_id: string; variable: Variable; value: number; is_unusual: boolean
  evaluator_id: string; support_request_id: string | null; recorded_at: string; created_at: string; updated_at: string
}

export interface Range {
  variable: Variable; unit: string; hard_min: number; hard_max: number; warn_min: number; warn_max: number; decimals: number
}

export interface ParticipantResult {
  id: string; campaign_id: string; number: number; full_name: string; sex: 'M' | 'F'; birth_date: string | null; age: number | null
  group_id: string; group_code: string; needs_review: boolean; review_note: string | null; event_date: string
  peso: number | null; talla: number | null; cintura: number | null; perimetro_braquial: number | null; pliegue_tricipital: number | null
  n_measurements: number; any_unusual: boolean; imc: number | null; imc_clasificacion: string | null
  rct: number | null; cmb: number | null; estado: EvalStatus
}

export interface SupportRequest {
  id: string; participant_id: string; type: RequestType; reason: string; origin_group_id: string; target_group_id: string
  variables: Variable[]; done_variables?: Variable[]; status: RequestStatus; requested_by: string; resolved_by: string | null
  resolved_at: string | null; resolution_note: string | null; created_at: string
}

export interface AuditEntry { id: number; actor_id: string | null; action: string; entity: string; entity_id: string | null; details: Record<string, unknown>; created_at: string }

export const VARIABLES: { key: Variable; label: string; short: string; unit: string }[] = [
  { key: 'peso', label: 'Peso corporal', short: 'Peso', unit: 'kg' },
  { key: 'talla', label: 'Talla', short: 'Talla', unit: 'cm' },
  { key: 'cintura', label: 'Perímetro de cintura', short: 'Cintura', unit: 'cm' },
  { key: 'perimetro_braquial', label: 'Perímetro braquial medio', short: 'Brazo', unit: 'cm' },
  { key: 'pliegue_tricipital', label: 'Pliegue cutáneo tricipital', short: 'Pliegue', unit: 'mm' },
]
export const varLabel = (v: Variable) => VARIABLES.find((x) => x.key === v)!.label

export const STATIONS: { key: Station; label: string; variables: Variable[] }[] = [
  { key: 'registro', label: 'Registro y orientación', variables: [] },
  { key: 'peso', label: 'Estación 1 · Peso corporal', variables: ['peso'] },
  { key: 'talla', label: 'Estación 2 · Talla', variables: ['talla'] },
  { key: 'cintura', label: 'Estación 3 · Perímetro de cintura', variables: ['cintura'] },
  { key: 'brazo', label: 'Estación 4 · Perímetro braquial y pliegue tricipital', variables: ['perimetro_braquial', 'pliegue_tricipital'] },
  { key: 'supervision', label: 'Supervisión y apoyo', variables: ['peso', 'talla', 'cintura', 'perimetro_braquial', 'pliegue_tricipital'] },
]
export const stationOf = (s: Station | null) => STATIONS.find((x) => x.key === s)

export const STATUS_LABEL: Record<EvalStatus, string> = {
  sin_iniciar: 'Sin iniciar', en_proceso: 'En proceso', completo: 'Completo', requiere_revision: 'Requiere revisión',
}
export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  apoyo_temporal: 'Apoyo temporal', apoyo_varias: 'Apoyo para varias mediciones', traslado: 'Traslado permanente',
  remedicion: 'Volver a medir',
}
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada', cancelada: 'Cancelada', finalizada: 'Finalizada',
}
export const pad = (n: number) => String(n).padStart(3, '0')
