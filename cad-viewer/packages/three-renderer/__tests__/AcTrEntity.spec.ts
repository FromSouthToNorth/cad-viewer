import { AcGeMatrix3d } from '@mlightcad/data-model'
import * as THREE from 'three'

import { expectWcsBboxCloseTo } from './helpers/expectWcsBbox'
import { AcTrEntity } from '../src/object/AcTrEntity'
import { AcTrRenderContext } from '../src/renderer/AcTrRenderContext'
import { setMaterialMetadata } from '../src/style/AcTrMaterialMetadata'
import { AcTrStyleManager } from '../src/style/AcTrStyleManager'

describe('AcTrEntity wcsBbox', () => {
  it('starts empty and accepts explicit WCS bounds', () => {
    const entity = new AcTrEntity(new AcTrRenderContext())

    expect(entity.wcsBbox.isEmpty()).toBe(true)

    entity.wcsBbox.set(new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6))

    expectWcsBboxCloseTo(entity.wcsBbox, [1, 2, 3], [4, 5, 6])
  })

  it('updates wcsBbox when applyMatrix is called', () => {
    const entity = new AcTrEntity(new AcTrRenderContext())
    entity.wcsBbox.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 5, 0))

    entity.applyMatrix(new AcGeMatrix3d().makeTranslation(100, 200, 0))

    expectWcsBboxCloseTo(entity.wcsBbox, [100, 200, 0], [110, 205, 0])
  })

  it('copies wcsBbox in fastDeepClone', () => {
    const context = new AcTrRenderContext(new AcTrStyleManager())
    const entity = new AcTrEntity(context)
    entity.objectId = 'entity-1'
    entity.wcsBbox.set(new THREE.Vector3(3, 4, 0), new THREE.Vector3(8, 9, 0))

    const cloned = entity.fastDeepClone()

    expectWcsBboxCloseTo(cloned.wcsBbox, [3, 4, 0], [8, 9, 0])
  })

  it('exposes childCount from the Object3D children list', () => {
    const context = new AcTrRenderContext()
    const parent = new AcTrEntity(context)
    expect(parent.childCount).toBe(0)

    parent.addChild(new AcTrEntity(context))
    parent.addChild(new AcTrEntity(context))
    expect(parent.childCount).toBe(2)
  })
})

describe('AcTrEntity.disposeObject', () => {
  it('skips disposing style-cache shared materials', () => {
    const material = new THREE.MeshBasicMaterial()
    setMaterialMetadata(material, { isShared: true })
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
    const disposeSpy = jest.spyOn(material, 'dispose')

    AcTrEntity.disposeObject(mesh, false)

    expect(disposeSpy).not.toHaveBeenCalled()
  })

  it('disposes unmarked private materials', () => {
    const material = new THREE.MeshBasicMaterial()
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
    const disposeSpy = jest.spyOn(material, 'dispose')

    AcTrEntity.disposeObject(mesh, false)

    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('disposes private materials in multi-material objects except shared entries', () => {
    const shared = new THREE.MeshBasicMaterial()
    setMaterialMetadata(shared, { isShared: true })
    const privateMaterial = new THREE.MeshBasicMaterial()
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [
      shared,
      privateMaterial
    ])
    const sharedDisposeSpy = jest.spyOn(shared, 'dispose')
    const privateDisposeSpy = jest.spyOn(privateMaterial, 'dispose')

    AcTrEntity.disposeObject(mesh, false)

    expect(sharedDisposeSpy).not.toHaveBeenCalled()
    expect(privateDisposeSpy).toHaveBeenCalledTimes(1)
  })
})
