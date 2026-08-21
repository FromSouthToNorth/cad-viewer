import {
  MTextAttachmentPoint,
  MTextData,
  MTextObject,
  TextStyle
} from '@mlightcad/mtext-renderer'
import * as THREE from 'three'

import {
  AcTrMTextGlyphCache,
  clonePlacedMTextTemplate
} from '../src/renderer/AcTrMTextGlyphCache'

function createContent(
  overrides: Partial<MTextData> = {}
): MTextData {
  return {
    text: '100',
    height: 2.5,
    width: 0,
    position: { x: 0, y: 0, z: 0 },
    ...overrides
  }
}

function createStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    name: 'Standard',
    standardFlag: 0,
    fixedTextHeight: 0,
    widthFactor: 1,
    obliqueAngle: 0,
    textGenerationFlag: 0,
    lastHeight: 2.5,
    font: 'arial.ttf',
    bigFont: 'gbcbig.shx',
    ...overrides
  }
}

const colorSettings = {
  byLayerColor: 0xffffff,
  byBlockColor: 0xffffff,
  color: { aci: 256 } as never
}

function createTemplate(position = { x: 0, y: 0, z: 0 }): MTextObject {
  const root = new THREE.Group()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
  )
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  mesh.position.set(1, 2, 0)
  root.add(mesh)
  root.position.set(position.x, position.y, position.z)
  const layoutBox = new THREE.Box3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(5, 3, 0)
  )
  root.userData.logicalBounds = { minX: 0, maxX: 5, minY: 0, maxY: 3 }
  mesh.userData.layout = {
    chars: [{ type: 'CHAR' as never, box: layoutBox, char: '1', children: [] }]
  }
  ;(root as unknown as MTextObject).box = new THREE.Box3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(5, 3, 0)
  )
  return root as unknown as MTextObject
}

describe('AcTrMTextGlyphCache', () => {
  it('builds the same key for identical content at different positions', () => {
    const cache = new AcTrMTextGlyphCache()
    const a = cache.buildKey(
      createContent({ position: { x: 0, y: 0, z: 0 } }),
      createStyle(),
      colorSettings
    )
    const b = cache.buildKey(
      createContent({ position: { x: 42, y: 7, z: 3 } }),
      createStyle(),
      colorSettings
    )
    expect(a).toBe(b)
  })

  it('distinguishes content, style and colour differences', () => {
    const cache = new AcTrMTextGlyphCache()
    const base = cache.buildKey(createContent(), createStyle(), colorSettings)
    expect(
      cache.buildKey(createContent({ text: '200' }), createStyle(), colorSettings)
    ).not.toBe(base)
    expect(
      cache.buildKey(createContent(), createStyle({ font: 'simfang.ttf' }), colorSettings)
    ).not.toBe(base)
    expect(
      cache.buildKey(createContent(), createStyle(), {
        ...colorSettings,
        byLayerColor: 0xff0000
      })
    ).not.toBe(base)
    expect(
      cache.buildKey(
        createContent({ attachmentPoint: MTextAttachmentPoint.TopLeft }),
        createStyle(),
        colorSettings
      )
    ).not.toBe(base)
  })

  it('stores and retrieves templates with LRU recency refresh', () => {
    const cache = new AcTrMTextGlyphCache({ maxEntries: 2 })
    const a = createTemplate()
    const b = createTemplate()
    const c = createTemplate()

    cache.set('a', a)
    cache.set('b', b)

    expect(cache.get('a')).toBe(a) // refresh recency of 'a'

    cache.set('c', c) // over budget → evict least-recently-used ('b')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(a)
    expect(cache.get('c')).toBe(c)
    expect(cache.size).toBe(2)
  })

  it('evicts by estimated byte budget', () => {
    const cache = new AcTrMTextGlyphCache({
      maxEntries: 100,
      maxEstimatedBytes: 1
    })
    cache.set('a', createTemplate())
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.getStats().estimatedBytes).toBe(0)
  })

  it('clears all entries', () => {
    const cache = new AcTrMTextGlyphCache()
    cache.set('a', createTemplate())
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.getStats().estimatedBytes).toBe(0)
  })
})

describe('clonePlacedMTextTemplate', () => {
  it('returns a repositioned clone without moving the template', () => {
    const template = createTemplate({ x: 1, y: 1, z: 0 })
    const clone = clonePlacedMTextTemplate(template, {
      x: 100,
      y: 200,
      z: 0
    })

    expect(clone).not.toBe(template)
    expect(clone.position.x).toBe(100)
    expect(clone.position.y).toBe(200)
    expect(template.position.x).toBe(1)
    expect(template.position.y).toBe(1)
  })

  it('isolates leaf geometry from the shared template', () => {
    const template = createTemplate()
    const templateGeometry = (template.children[0] as THREE.Mesh).geometry

    const clone = clonePlacedMTextTemplate(template, { x: 5, y: 5, z: 0 })
    const cloneGeometry = (clone.children[0] as THREE.Mesh).geometry

    expect(cloneGeometry).not.toBe(templateGeometry)
    const clonePositions = cloneGeometry.getAttribute('position').array
    clonePositions[0] = 999

    const templatePositions = templateGeometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute
    expect(templatePositions.array[0]).toBe(0)
  })

  it('restores Box3 prototypes in layout metadata shared with the template', () => {
    const template = createTemplate()
    const clone = clonePlacedMTextTemplate(template, { x: 0, y: 0, z: 0 })

    const mesh = clone.children[0] as THREE.Mesh
    const layout = mesh.userData.layout as {
      chars: Array<{ box: THREE.Box3 }>
    }
    expect(layout.chars[0].box).toBeInstanceOf(THREE.Box3)
    expect(layout.chars[0].box.min.x).toBe(0)
    // Shared by reference with the template so pick layout stays consistent.
    const templateMesh = template.children[0] as THREE.Mesh
    expect(layout).toBe(templateMesh.userData.layout)
  })

  it('copies the logical box onto the clone', () => {
    const template = createTemplate()
    const clone = clonePlacedMTextTemplate(template, { x: 0, y: 0, z: 0 })

    expect(clone.box).toBeInstanceOf(THREE.Box3)
    expect(clone.box.min.x).toBe(0)
    expect(clone.box.max.x).toBe(5)
  })

  it('lets the consumer mutate the clone tree without affecting the template', () => {
    const template = createTemplate()
    const clone = clonePlacedMTextTemplate(template, { x: 0, y: 0, z: 0 })

    // Consumer behaviour: reparent under an entity and strip children.
    const entity = new THREE.Group()
    entity.add(clone)
    const leaf = clone.children[0]
    clone.remove(leaf)
    entity.add(leaf)
    leaf.position.set(77, 77, 0)

    expect(template.children).toHaveLength(1)
    expect((template.children[0] as THREE.Mesh).position.x).toBe(1)
  })
})
