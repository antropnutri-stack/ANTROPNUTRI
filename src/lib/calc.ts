// Indicadores derivados. Deben coincidir con la vista participant_results en SQL.
export function imc(pesoKg?: number | null, tallaCm?: number | null): number | null {
  if (!pesoKg || !tallaCm) return null
  return round(pesoKg / (tallaCm / 100) ** 2, 1)
}

export function imcClass(value: number | null, age?: number | null): string | null {
  if (value == null) return null
  if (age != null && age < 18) return 'No aplica (menor de 18)'
  if (value < 18.5) return 'Bajo peso'
  if (value < 25) return 'Peso normal'
  if (value < 30) return 'Sobrepeso'
  return 'Obesidad'
}

export function rct(cinturaCm?: number | null, tallaCm?: number | null): number | null {
  if (!cinturaCm || !tallaCm) return null
  return round(cinturaCm / tallaCm, 3)
}

/** Circunferencia muscular del brazo estimada: PB (cm) − π·PCT(mm)/10 */
export function cmb(pbCm?: number | null, pctMm?: number | null): number | null {
  if (!pbCm || !pctMm) return null
  return round(pbCm - Math.PI * (pctMm / 10), 1)
}

export function ageFrom(birth: string | null | undefined, at: Date = new Date()): number | null {
  if (!birth) return null
  const b = new Date(birth + 'T00:00:00')
  if (isNaN(b.getTime())) return null
  let a = at.getFullYear() - b.getFullYear()
  const m = at.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && at.getDate() < b.getDate())) a--
  return a
}

export function round(x: number, d: number) {
  const f = 10 ** d
  return Math.round((x + Number.EPSILON) * f) / f
}

/** Normaliza un nombre para detectar duplicados (sin tildes, espacios ni mayúsculas). */
export function normName(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}
