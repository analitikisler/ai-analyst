/// <reference types="vite/client" />

/** Replaced at build time (vite.config.ts `define`): true in the fixtures demo build, so its parts tree-shake away. */
declare const __DEMO__: boolean;

interface ImportMetaEnv {
  /** "fixtures" builds the demo on the mock server; anything else (the default) talks to the ai-analyst server. */
  readonly VITE_API?: "http" | "fixtures";
}
