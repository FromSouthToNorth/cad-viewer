import * as THREE from 'three'

import {
  AcTrBatchHighlightState,
  installBatchHighlightRenderer,
  patchMaterialForBatchHighlight
} from '../src/batch/highlight'

describe('AcTrBatchHighlightShaders', () => {
  it('invokes the previous onBeforeRender with the drawable as `this`', () => {
    // Mirrors three's LineSegments2.prototype.onBeforeRender, which reads
    // `this.material.uniforms` and throws when called with an undefined `this`.
    const material = new THREE.ShaderMaterial({
      uniforms: { resolution: { value: new THREE.Vector2(800, 600) } },
      vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }'
    })
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
    const seenThis: unknown[] = []
    mesh.onBeforeRender = function (renderer) {
      seenThis.push(this)
      const uniforms = this.material.uniforms
      if (uniforms && uniforms.resolution) {
        uniforms.resolution.value.set(
          renderer.domElement.width,
          renderer.domElement.height
        )
      }
    }

    const state = new AcTrBatchHighlightState()
    state.setHighlight(0, 'select', true)
    installBatchHighlightRenderer(mesh, state)

    const rendererMock = {
      domElement: { width: 1280, height: 720 }
    } as unknown as THREE.WebGLRenderer

    expect(() =>
      mesh.onBeforeRender(
        rendererMock,
        new THREE.Scene(),
        new THREE.PerspectiveCamera(),
        mesh.geometry,
        material,
        new THREE.Group()
      )
    ).not.toThrow()

    expect(seenThis).toHaveLength(1)
    expect(seenThis[0]).toBe(mesh)
    expect(material.uniforms.resolution.value.x).toBe(1280)
    expect(material.uniforms.resolution.value.y).toBe(720)
  })

  it('skips the highlight binding pass while still chaining the previous hook', () => {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial()
    )
    let chained = false
    mesh.onBeforeRender = () => {
      chained = true
    }

    const state = new AcTrBatchHighlightState()
    installBatchHighlightRenderer(mesh, state)

    mesh.onBeforeRender(
      {} as THREE.WebGLRenderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      mesh.geometry,
      mesh.material as THREE.Material,
      new THREE.Group()
    )

    expect(chained).toBe(true)
  })

  it('prepends the highlight helper when replacing a literal gl_FragColor assignment', () => {
    // LineMaterial-style raw source: the final assignment is declared
    // literally, so the assignment replacement wins. The patched shader must
    // define the helper before calling it, otherwise the program fails to
    // compile with "no matching overloaded function found".
    const material = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 diffuse;\nuniform float alpha;\n' +
        'void main() { gl_FragColor = vec4( diffuseColor.rgb, alpha ); }'
    })

    patchMaterialForBatchHighlight(material)

    expect(material.fragmentShader).toContain(
      'applyBatchHighlight( diffuseColor.rgb )'
    )
    expect(material.fragmentShader).toContain(
      'vec3 applyBatchHighlight(vec3 color)'
    )
    // three r172: needsUpdate is a setter-only accessor that bumps version.
    expect(material.version).toBeGreaterThan(0)
  })

  it('leaves unpatched materials alone when injection cannot be wired', () => {
    const source = 'void main() { gl_FragColor = vec4(1.0); }'
    const material = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
      fragmentShader: source
    })

    patchMaterialForBatchHighlight(material)

    // No matching assignment pattern and no output-processing includes:
    // the material must stay untouched instead of being half-patched.
    expect(material.fragmentShader).toBe(source)
    expect(material.version).toBe(0)
  })
})
