import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';

export default defineConfig({
  plugins: [
    svelte({
      preprocess: sveltePreprocess()
    })
  ],
  build: {
    outDir: 'public/dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/main.ts',
      name: 'MyAIFrontend',
      formats: ['iife'],
      fileName: () => 'bundle.js'
    }
  }
});
