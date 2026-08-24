import { acdbDxfKeywordUpper } from '../src/base/AcDbDxfKeyword'

describe('acdbDxfKeywordUpper', () => {
  it('returns the same string reference when already uppercase ASCII', () => {
    const value = 'LWPOLYLINE'
    expect(acdbDxfKeywordUpper(value)).toBe(value)
    const section = 'SECTION'
    expect(acdbDxfKeywordUpper(section)).toBe(section)
    const empty = ''
    expect(acdbDxfKeywordUpper(empty)).toBe(empty)
  })

  it('returns the same reference for ASCII without cased letters', () => {
    const value = 'AC1021'
    expect(acdbDxfKeywordUpper(value)).toBe(value)
  })

  it('uppercases ASCII lowercase and mixed input', () => {
    expect(acdbDxfKeywordUpper('line')).toBe('LINE')
    expect(acdbDxfKeywordUpper('LwPolyline')).toBe('LWPOLYLINE')
    expect(acdbDxfKeywordUpper('2f')).toBe('2F')
  })

  it('matches String.prototype.toUpperCase for non-ASCII input', () => {
    for (const value of ['straße', 'müller', 'ßeta', '漢字ABC', 'ÉCOLE']) {
      expect(acdbDxfKeywordUpper(value)).toBe(value.toUpperCase())
    }
  })
})
