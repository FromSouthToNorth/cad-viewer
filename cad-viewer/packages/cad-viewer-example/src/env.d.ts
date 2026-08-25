/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** /@fs/ 前缀,指向 cad-tools/cadLayer 目录(由 vite.config.ts 注入) */
  readonly VITE_CAD_LAYER_PREFIX?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
