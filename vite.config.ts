import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: mode === 'production' ? false : true,
    minify: mode === 'production' ? 'esbuild' : false,
    rollupOptions: {
      input: 'src/index.ts',
      output: {
        format: 'es',
        entryFileNames: 'index.js',
        inlineDynamicImports: true,
        assetFileNames: (info: any) => {
          const name = info?.names?.[0] ?? info?.name ?? '';
          return name.endsWith('.css') ? 'index.css' : 'assets/[name][extname]';
        },
      },
    },
  },
}));
