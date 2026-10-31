import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative paths so the same build can later be served from a .dot / Bulletin CID.
  base: './',
  plugins: [react()],
});
