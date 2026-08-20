import { AcApEntityService } from '../src/service/AcApEntityService'

describe('AcApEntityService', () => {
  test('copyDisplayTraits copies visual properties', () => {
    const source = {
      layer: 'A',
      color: { clone: () => ({ cloned: true }) },
      lineType: 'Continuous',
      lineWeight: 1,
      linetypeScale: 1,
      transparency: 0,
      visibility: true
    }
    const target = {
      layer: '',
      color: null as unknown,
      lineType: '',
      lineWeight: 0,
      linetypeScale: 0,
      transparency: 0,
      visibility: false
    }

    AcApEntityService.copyDisplayTraits(source as never, target as never)

    expect(target.layer).toBe('A')
    expect(target.color).toEqual({ cloned: true })
  })

  test('eraseEntities erases existing entities in one batched block-table call', () => {
    const removed: string[][] = []
    const db = {
      tables: {
        blockTable: {
          getEntityById: jest.fn((objectId: string) =>
            objectId === 'missing' ? undefined : { objectId }
          ),
          removeEntity: jest.fn((ids: string[]) => {
            removed.push(ids)
            return true
          })
        }
      }
    }
    const service = new AcApEntityService(db as never)

    const count = service.eraseEntities(['a', 'b', 'missing'])

    expect(count).toBe(2)
    expect(removed).toEqual([['a', 'b']])
    expect(db.tables.blockTable.removeEntity).toHaveBeenCalledTimes(1)
  })

  test('eraseEntities no-ops for an empty id list', () => {
    const removeEntity = jest.fn()
    const db = {
      tables: {
        blockTable: {
          getEntityById: jest.fn(),
          removeEntity
        }
      }
    }
    const service = new AcApEntityService(db as never)

    expect(service.eraseEntities([])).toBe(0)
    expect(removeEntity).not.toHaveBeenCalled()
  })
})
