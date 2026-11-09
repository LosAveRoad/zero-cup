import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function fileProtocolCompatibilityPlugin(): Plugin {
  return {
    name: 'file-protocol-compatibility',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script data-file-redirect[\s\S]*?<\/script>\s*/g, '')
        .replace(/<script type="module" crossorigin/g, '<script defer')
        .replace(
          /<link rel="stylesheet" crossorigin/g,
          '<link rel="stylesheet"',
        );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), fileProtocolCompatibilityPlugin()],
  build: {
    modulePreload: false,
  },
});
