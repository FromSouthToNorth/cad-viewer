import type { Config } from 'jest'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Resolves a CJS package from the pnpm virtual store.
 *
 * `lodash-es` is mapped to CJS `lodash` for tests, but with pnpm's strict
 * layout `lodash` is not reachable through the requiring file's own
 * node_modules chain. Look the package up in the store instead, without
 * pinning a version.
 */
function findStorePackage(name: string): string | undefined {
  const store = resolve(process.cwd(), 'node_modules', '.pnpm')
  if (!existsSync(store)) {
    return undefined
  }
  for (const entry of readdirSync(store)) {
    const candidate = resolve(store, entry, 'node_modules', name)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

const lodashCjsModule = findStorePackage('lodash') ?? 'lodash'

const config: Config = {
  verbose: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.jest.json',
        diagnostics: {
          // data-model sources carry @ts-expect-error directives that are only
          // "used" under the package tsconfig (noUnusedParameters). The jest
          // tsconfig disables those checks, making the directives unused here.
          ignoreCodes: [2578]
        }
      }
    ],
    '^.+\\.js$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true
        }
      }
    ]
  },
  transformIgnorePatterns: [
    '/node_modules/(?!.*(mtext-parser|rbush|quickselect))'
  ],
  testPathIgnorePatterns: [
    '/e2e/',
    '/__tests__/helpers/'
  ],
  moduleNameMapper: {
    '^@mlightcad/common$': '<rootDir>/packages/common/src/index.ts',
    '^@mlightcad/geometry-engine$':
      '<rootDir>/packages/geometry-engine/src/index.ts',
    '^@mlightcad/graphic-interface$':
      '<rootDir>/packages/graphic-interface/src/index.ts',
    '^@mlightcad/data-model$': '<rootDir>/packages/data-model/src/index.ts',
    '^@mlightcad/libredwg-converter$':
      '<rootDir>/packages/libredwg-converter/src/index.ts',
    '^lodash-es$': lodashCjsModule,
    '^three$': '<rootDir>/packages/three-renderer/node_modules/three/build/three.cjs',
    '^three/examples/jsm/lines/LineMaterial\\.js$':
      '<rootDir>/test/mocks/three/LineMaterial.js',
    '^three/examples/jsm/lines/LineSegments2\\.js$':
      '<rootDir>/test/mocks/three/LineSegments2.js',
    '^three/examples/jsm/lines/LineSegmentsGeometry\\.js$':
      '<rootDir>/test/mocks/three/LineSegmentsGeometry.js',
    '^three/examples/jsm/renderers/CSS2DRenderer\\.js$':
      '<rootDir>/test/mocks/three/CSS2DRenderer.js',
    '^three/examples/jsm/utils/BufferGeometryUtils\\.js$':
      '<rootDir>/test/mocks/three/BufferGeometryUtils.js',
    '^three/examples/jsm/controls/OrbitControls(\\.js)?$':
      '<rootDir>/test/mocks/three/OrbitControls.js'
  }
}

export default config
