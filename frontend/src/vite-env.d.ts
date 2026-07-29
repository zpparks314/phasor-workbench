/// <reference types="vite/client" />

/**
 * Typed environment variables.
 *
 * Vite's default ImportMetaEnv has an `any` index signature, which silently
 * defeats type-aware linting anywhere env values are used. Declaring the
 * variables the project actually reads restores that safety.
 *
 * These are optional because Vite substitutes them at build time and a
 * variable absent from .env resolves to undefined. Declaring them as `string`
 * would be a lie that pushes the failure to runtime.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_MOCK_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
