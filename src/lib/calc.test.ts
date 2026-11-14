import { describe, expect, it } from 'vitest'
import { ageFrom, cmb, imc, imcClass, normName, rct } from './calc'

describe('indicadores', () => {
  it('IMC según ejemplos del documento', () => {
    expect(imc(68.5, 170)).toBe(23.7)
    expect(imc(74.2, 168)).toBe(26.3)
    expect(imc(59.8, 163)).toBe(22.5)
    expect(imc(null, 170)).toBeNull()
  })
  it('clasificación IMC adultos', () => {
    expect(imcClass(18.4, 20)).toBe('Bajo peso')
    expect(imcClass(18.5, 20)).toBe('Peso normal')
    expect(imcClass(24.9, 20)).toBe('Peso normal')
    expect(imcClass(25, 20)).toBe('Sobrepeso')
    expect(imcClass(30, 20)).toBe('Obesidad')
    expect(imcClass(30, 16)).toBe('No aplica (menor de 18)')
  })
  it('RCT y CMB', () => {
    expect(rct(78, 170)).toBe(0.459)
    expect(cmb(29, 12)).toBe(25.2)
  })
  it('edad exacta', () => {
    expect(ageFrom('2005-11-15', new Date('2026-11-14T12:00'))).toBe(20)
    expect(ageFrom('2005-11-14', new Date('2026-11-14T12:00'))).toBe(21)
  })
  it('normaliza nombres', () => {
    expect(normName('  José   PÉREZ ')).toBe('jose perez')
  })
})
