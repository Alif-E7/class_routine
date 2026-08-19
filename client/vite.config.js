import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') {
              console.warn(`[vite proxy] Backend connection ${err.code} — Express server on :4000 may be starting or unreachable.`);
            } else {
              console.error('[vite proxy error]', err);
            }
            if (res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                code: 'PROXY_ERROR',
                message: 'Backend server is temporarily unreachable. Please ensure backend is running.'
              }));
            }
          });
        }
      }
    }
  }
})
