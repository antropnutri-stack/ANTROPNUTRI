import type { Workbook, Worksheet } from 'exceljs'
import { normName } from './calc'
import type { AuditEntry, Group, Measurement, ParticipantResult, Profile, SupportRequest } from './types'
import { REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, STATUS_LABEL, VARIABLES, pad, varLabel } from './types'

const loadExcel = async () => (await import('exceljs')).default

export interface ImportRow {
  row: number
  full_name: string
  sex: string
  birth_date: string
  age: string
  group_code: string
  number: string
  issues: string[]
  duplicateOf?: string
  include: boolean
}

const HEADERS: Record<keyof Pick<ImportRow, 'full_name' | 'sex' | 'birth_date' | 'age' | 'group_code' | 'number'>, string[]> = {
  full_name: ['nombres y apellidos', 'nombre completo', 'nombres', 'nombre', 'apellidos y nombres', 'participante'],
  sex: ['sexo', 'genero'],
  birth_date: ['fecha de nacimiento', 'fecha nacimiento', 'nacimiento', 'f. nacimiento', 'fnac'],
  age: ['edad'],
  group_code: ['grupo'],
  number: ['numero', 'n°', 'nº', 'n.º', 'nro', 'codigo', 'n'],
}

function cellText(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((r) => r.text).join('')
    if (o.text) return o.text
    if (o.result != null) return cellText(o.result)
  }
  return String(v).trim()
}

function parseDate(s: string): string {
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/) // dd/mm/aaaa
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{5}$/.test(s)) { // número de serie de Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  return 'invalida:' + s
}

function parseSex(s: string): string {
  const t = normName(s)
  if (['m', 'masculino', 'hombre', 'varon', 'h'].includes(t)) return 'M'
  if (['f', 'femenino', 'mujer'].includes(t)) return 'F'
  return s ? 'invalido:' + s : ''
}

export async function parseParticipantsFile(file: File, existing: { full_name: string; birth_date: string | null; number: number }[], groups: Group[]): Promise<ImportRow[]> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('El archivo no tiene hojas.')

  // Buscar fila de encabezados en las primeras 10 filas
  let headerRow = 0
  const cols: Partial<Record<keyof typeof HEADERS, number>> = {}
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
    const row = ws.getRow(r)
    row.eachCell((c, col) => {
      const t = normName(cellText(c.value)).replace(/:$/, '')
      for (const [k, aliases] of Object.entries(HEADERS)) {
        if (aliases.includes(t) && !cols[k as keyof typeof HEADERS]) cols[k as keyof typeof HEADERS] = col
      }
    })
    if (cols.full_name) headerRow = r
  }
  if (!headerRow) throw new Error('No se encontró la columna «Nombres y apellidos». Revise los encabezados.')

  const existingKeys = new Map(existing.map((p) => [normName(p.full_name) + '|' + (p.birth_date ?? ''), p]))
  const existingNames = new Map(existing.map((p) => [normName(p.full_name), p]))
  const existingNumbers = new Set(existing.map((p) => p.number))
  const seen = new Map<string, number>()
  const seenNumbers = new Set<number>()
  const out: ImportRow[] = []
  const groupCodes = new Set(groups.map((g) => g.code))

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const get = (k: keyof typeof HEADERS) => (cols[k] ? cellText(row.getCell(cols[k]!).value) : '')
    const full_name = get('full_name').replace(/\s+/g, ' ').trim()
    if (!full_name) continue
    const item: ImportRow = {
      row: r, full_name, sex: parseSex(get('sex')), birth_date: parseDate(get('birth_date')),
      age: get('age').replace(/\D/g, ''), group_code: get('group_code').toUpperCase(), number: get('number').replace(/\D/g, ''),
      issues: [], include: true,
    }
    if (!item.sex) item.issues.push('Falta sexo')
    if (item.sex.startsWith('invalido:')) item.issues.push(`Sexo no reconocido: «${item.sex.slice(9)}»`)
    if (item.birth_date.startsWith('invalida:')) item.issues.push(`Fecha no reconocida: «${item.birth_date.slice(9)}»`)
    if (!item.birth_date && !item.age) item.issues.push('Falta fecha de nacimiento o edad')
    if (item.group_code && !groupCodes.has(item.group_code)) item.issues.push(`Grupo «${item.group_code}» no existe`)
    if (item.number) {
      const n = Number(item.number)
      if (existingNumbers.has(n) || seenNumbers.has(n)) item.issues.push(`Número ${pad(n)} ya asignado`)
      seenNumbers.add(n)
    }
    const k = normName(full_name) + '|' + (item.birth_date.startsWith('invalida') ? '' : item.birth_date)
    const ex = existingKeys.get(k) ?? (!item.birth_date ? existingNames.get(normName(full_name)) : undefined)
    if (ex) item.duplicateOf = `Ya registrado como ${pad(ex.number)}`
    else if (seen.has(k)) item.duplicateOf = `Repetido en fila ${seen.get(k)}`
    seen.set(k, r)
    item.include = item.issues.length === 0 && !item.duplicateOf
    out.push(item)
  }
  return out
}

export async function downloadTemplate() {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Participantes')
  ws.columns = [
    { header: 'Nombres y apellidos', width: 36 }, { header: 'Sexo', width: 8 },
    { header: 'Fecha de nacimiento', width: 20 }, { header: 'Edad', width: 8 },
    { header: 'Grupo', width: 8 }, { header: 'Número', width: 10 },
  ]
  ws.addRow(['Apellido Apellido, Nombre', 'F', '2005-04-12', '', '', ''])
  styleHeader(ws)
  await save(wb, 'plantilla_participantes.xlsx')
}

function styleHeader(ws: Worksheet) {
  const h = ws.getRow(1)
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B3A29' } }
  h.alignment = { vertical: 'middle', wrapText: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
}

async function save(wb: Workbook, name: string) {
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export interface ExportData {
  campaignName: string
  results: ParticipantResult[]
  measurements: Measurement[]
  profiles: Profile[]
  groups: Group[]
  requests: SupportRequest[]
  audit: AuditEntry[] | null
}

export async function exportWorkbook(d: ExportData) {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ANTROPNUTRI'
  wb.created = new Date()
  const who = (id: string | null | undefined) => d.profiles.find((p) => p.id === id)?.display_name ?? ''
  const grp = (id: string) => d.groups.find((g) => g.id === id)?.code ?? ''
  const byP = new Map<string, Map<string, Measurement>>()
  for (const m of d.measurements) {
    if (!byP.has(m.participant_id)) byP.set(m.participant_id, new Map())
    byP.get(m.participant_id)!.set(m.variable, m)
  }

  // 1. Resultados: una fila por participante
  const ws = wb.addWorksheet('Resultados')
  ws.columns = [
    { header: 'N.º', key: 'n', width: 7 }, { header: 'Grupo', key: 'g', width: 7 },
    { header: 'Nombres y apellidos', key: 'name', width: 34 }, { header: 'Sexo', key: 'sex', width: 6 },
    { header: 'Fecha de nacimiento', key: 'bd', width: 13 }, { header: 'Edad', key: 'age', width: 6 },
    { header: 'Fecha de evaluación', key: 'ed', width: 13 },
    { header: 'Peso (kg)', key: 'peso', width: 9 }, { header: 'Talla (cm)', key: 'talla', width: 9 },
    { header: 'Cintura (cm)', key: 'cintura', width: 10 }, { header: 'Perímetro braquial (cm)', key: 'perimetro_braquial', width: 11 },
    { header: 'Pliegue tricipital (mm)', key: 'pliegue_tricipital', width: 11 },
    { header: 'IMC (kg/m²)', key: 'imc', width: 9 }, { header: 'Clasificación IMC', key: 'imcc', width: 16 },
    { header: 'Relación cintura/talla', key: 'rct', width: 10 }, { header: 'CMB estimada (cm)', key: 'cmb', width: 10 },
    { header: 'Mediciones', key: 'nm', width: 9 }, { header: 'Estado', key: 'st', width: 16 },
    { header: 'Valor inusual confirmado', key: 'un', width: 10 },
    ...VARIABLES.map((v) => ({ header: `Evaluador · ${v.short}`, key: 'ev_' + v.key, width: 16 })),
  ]
  for (const r of [...d.results].sort((a, b) => a.number - b.number)) {
    const ms = byP.get(r.id)
    ws.addRow({
      n: pad(r.number), g: r.group_code, name: r.full_name, sex: r.sex, bd: r.birth_date ?? '', age: r.age,
      ed: r.event_date, peso: num(r.peso), talla: num(r.talla), cintura: num(r.cintura),
      perimetro_braquial: num(r.perimetro_braquial), pliegue_tricipital: num(r.pliegue_tricipital),
      imc: num(r.imc), imcc: r.imc_clasificacion ?? '', rct: num(r.rct), cmb: num(r.cmb),
      nm: r.n_measurements, st: STATUS_LABEL[r.estado], un: r.any_unusual ? 'Sí' : '',
      ...Object.fromEntries(VARIABLES.map((v) => ['ev_' + v.key, who(ms?.get(v.key)?.evaluator_id)])),
    })
  }
  styleHeader(ws)
  ws.getRow(1).height = 42

  // 2. Pendientes
  const wp = wb.addWorksheet('Pendientes')
  wp.columns = [{ header: 'N.º', width: 7 }, { header: 'Grupo', width: 7 }, { header: 'Nombres y apellidos', width: 34 },
    { header: 'Estado', width: 16 }, { header: 'Mediciones faltantes', width: 60 }]
  for (const r of d.results.filter((x) => x.estado !== 'completo').sort((a, b) => a.number - b.number)) {
    const ms = byP.get(r.id)
    wp.addRow([pad(r.number), r.group_code, r.full_name, STATUS_LABEL[r.estado],
      VARIABLES.filter((v) => !ms?.has(v.key)).map((v) => v.label).join(', ') || (r.review_note ?? '')])
  }
  styleHeader(wp)

  // 3. Detalle de mediciones
  const wm = wb.addWorksheet('Mediciones')
  wm.columns = [{ header: 'N.º', width: 7 }, { header: 'Variable', width: 26 }, { header: 'Valor', width: 8 },
    { header: 'Inusual', width: 8 }, { header: 'Evaluador', width: 18 }, { header: 'Código evaluador', width: 12 },
    { header: 'Registrado', width: 20 }, { header: 'Última modificación', width: 20 }, { header: 'Vía apoyo', width: 9 }]
  const num2 = new Map(d.results.map((r) => [r.id, r.number]))
  for (const m of [...d.measurements].sort((a, b) => (num2.get(a.participant_id) ?? 0) - (num2.get(b.participant_id) ?? 0))) {
    const p = d.profiles.find((x) => x.id === m.evaluator_id)
    wm.addRow([pad(num2.get(m.participant_id) ?? 0), varLabel(m.variable), Number(m.value), m.is_unusual ? 'Sí' : '',
      p?.display_name ?? '', p?.code ?? '', fmt(m.recorded_at), m.updated_at !== m.created_at ? fmt(m.updated_at) : '', m.support_request_id ? 'Sí' : ''])
  }
  styleHeader(wm)

  // 4. Solicitudes
  const wr = wb.addWorksheet('Solicitudes')
  wr.columns = [{ header: 'Fecha', width: 18 }, { header: 'N.º', width: 7 }, { header: 'Tipo', width: 24 },
    { header: 'Origen', width: 7 }, { header: 'Destino', width: 7 }, { header: 'Mediciones', width: 36 },
    { header: 'Motivo', width: 36 }, { header: 'Solicitó', width: 16 }, { header: 'Estado', width: 11 },
    { header: 'Resolvió', width: 16 }, { header: 'Fecha resolución', width: 18 }, { header: 'Nota', width: 30 }]
  for (const r of d.requests) {
    wr.addRow([fmt(r.created_at), pad(num2.get(r.participant_id) ?? 0), REQUEST_TYPE_LABEL[r.type], grp(r.origin_group_id),
      grp(r.target_group_id), r.variables.map(varLabel).join(', '), r.reason, who(r.requested_by),
      REQUEST_STATUS_LABEL[r.status], who(r.resolved_by), r.resolved_at ? fmt(r.resolved_at) : '', r.resolution_note ?? ''])
  }
  styleHeader(wr)

  // 5. Auditoría (si tiene permiso)
  if (d.audit) {
    const wa = wb.addWorksheet('Auditoría')
    wa.columns = [{ header: 'Fecha', width: 20 }, { header: 'Usuario', width: 18 }, { header: 'Acción', width: 24 },
      { header: 'Entidad', width: 14 }, { header: 'Detalle', width: 90 }]
    for (const a of d.audit) wa.addRow([fmt(a.created_at), who(a.actor_id), a.action, a.entity, JSON.stringify(a.details)])
    styleHeader(wa)
  }

  // 6. Resumen descriptivo
  const wsum = wb.addWorksheet('Resumen')
  wsum.columns = [{ header: 'Indicador', width: 30 }, { header: 'n', width: 8 }, { header: 'Media', width: 10 },
    { header: 'DE', width: 10 }, { header: 'Mínimo', width: 10 }, { header: 'Máximo', width: 10 }]
  const cols: [string, keyof ParticipantResult][] = [['Peso (kg)', 'peso'], ['Talla (cm)', 'talla'], ['Cintura (cm)', 'cintura'],
    ['Perímetro braquial (cm)', 'perimetro_braquial'], ['Pliegue tricipital (mm)', 'pliegue_tricipital'],
    ['IMC (kg/m²)', 'imc'], ['Relación cintura/talla', 'rct'], ['CMB estimada (cm)', 'cmb']]
  for (const [label, k] of cols) {
    const xs = d.results.map((r) => r[k]).filter((x): x is number => x != null).map(Number)
    const n = xs.length, mean = n ? xs.reduce((a, b) => a + b, 0) / n : 0
    const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0
    wsum.addRow([label, n, n ? +mean.toFixed(2) : '', n > 1 ? +sd.toFixed(2) : '', n ? Math.min(...xs) : '', n ? Math.max(...xs) : ''])
  }
  wsum.addRow([])
  wsum.addRow(['Participantes', d.results.length])
  for (const s of ['completo', 'en_proceso', 'sin_iniciar', 'requiere_revision'] as const) {
    wsum.addRow([STATUS_LABEL[s], d.results.filter((r) => r.estado === s).length])
  }
  styleHeader(wsum)

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  await save(wb, `ANTROPNUTRI_${d.campaignName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '_')}_${stamp}.xlsx`)
}

const num = (x: number | null) => (x == null ? null : Number(x))
const fmt = (s: string) => new Date(s).toLocaleString('es-PE')
