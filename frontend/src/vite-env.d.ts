// Vite-specific URL helpers — these aren't real npm modules, the suffixes
// are interpreted by the Vite plugin chain at build time.
declare module "*?worker&url" {
  const url: string;
  export default url;
}
declare module "*?url" {
  const url: string;
  export default url;
}
declare module "@ffmpeg/ffmpeg/worker?worker&url" {
  const url: string;
  export default url;
}
declare module "jassub/dist/worker/worker.js?worker&url" {
  const url: string;
  export default url;
}
declare module "jassub/dist/wasm/jassub-worker.wasm?url" {
  const url: string;
  export default url;
}
declare module "jassub/dist/wasm/jassub-worker-modern.wasm?url" {
  const url: string;
  export default url;
}
declare module "jassub/dist/default.woff2?url" {
  const url: string;
  export default url;
}
