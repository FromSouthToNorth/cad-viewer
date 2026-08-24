import { AcEdSelectionSet } from '../src/editor/input/AcEdSelectionSet'

describe('AcEdSelectionSet', () => {
  describe('invert', () => {
    test('adds unselected candidates and removes selected ones', () => {
      const set = new AcEdSelectionSet(['a', 'b'])

      const result = set.invert(['a', 'b', 'c', 'd'])

      expect(result.added).toEqual(['c', 'd'])
      expect(result.removed).toEqual(['a', 'b'])
      expect(set.ids).toEqual(['c', 'd'])
      expect(set.count).toBe(2)
    })

    test('leaves members that are not part of the candidates untouched', () => {
      const set = new AcEdSelectionSet(['a', 'keep'])

      set.invert(['a', 'b'])

      expect(set.ids).toEqual(['keep', 'b'])
    })

    test('fires selectionAdded and selectionRemoved with changed ids', () => {
      const set = new AcEdSelectionSet(['a'])
      const added = jest.fn()
      const removed = jest.fn()
      set.events.selectionAdded.addEventListener(added)
      set.events.selectionRemoved.addEventListener(removed)

      set.invert(['a', 'b'])

      expect(added).toHaveBeenCalledWith({ ids: ['b'] })
      expect(removed).toHaveBeenCalledWith({ ids: ['a'] })
    })

    test('does not fire events when nothing changes', () => {
      const set = new AcEdSelectionSet(['a'])
      const added = jest.fn()
      const removed = jest.fn()
      set.events.selectionAdded.addEventListener(added)
      set.events.selectionRemoved.addEventListener(removed)

      const result = set.invert([])

      expect(result.added).toEqual([])
      expect(result.removed).toEqual([])
      expect(added).not.toHaveBeenCalled()
      expect(removed).not.toHaveBeenCalled()
      expect(set.ids).toEqual(['a'])
    })
  })
})
