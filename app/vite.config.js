import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DESCRIPTORS = '@parity/product-sdk-descriptors/';
const STUB = '\0unused-descriptor:';

// @parity/product-sdk-chain-client dynamically imports metadata for every chain (~4-5 MB) although we only use
// devnet-asset-hub. In the build the others become empty modules (polkadot-products-devnet skill, app-sdk.md "Vite").
function onlyDevnetDescriptor() {
  return {
    name: 'only-devnet-descriptor',
    apply: 'build',
    enforce: 'pre',
    resolveId(id) {
      if (!id.startsWith(DESCRIPTORS)) return null;
      return id.slice(DESCRIPTORS.length) === 'devnet-asset-hub' ? null : STUB + id.slice(DESCRIPTORS.length);
    },
    load(id) {
      return id.startsWith(STUB) ? 'export {};' : null;
    },
  };
}

export default defineConfig({
  // Relative paths: the bundle is served from a Bulletin CID, not from a domain root.
  base: './',
  plugins: [react(), onlyDevnetDescriptor()],
  // Build stamp, so we can tell which CID the Host is actually showing.
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
});
