// Test-only stub for `@assets/*` URL imports. In the app, Vite resolves these to
// real bundled asset URLs (strings); under the node test env there is no bundler,
// so every `@assets/*` import collapses to this empty-string default. Engine code
// that imports an asset only stores the URL, so a string is sufficient for tests.
export default "";
