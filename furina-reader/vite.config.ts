/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri expects a fixed port and no clearing of the screen.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: !isTauri,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  build: {
    target: isTauri ? ['es2021', 'chrome105'] : 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', '@tanstack/react-virtual', 'zustand'],
          pdf: ['pdfjs-dist'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
