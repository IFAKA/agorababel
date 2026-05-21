import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { handleAnalyzeRequest, handleAnalyzeStreamRequest, handleEventsRequest, handleMarketIntelligenceRequest, handleRuntimeStatusRequest } from './src/server/analyze'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

function analyzeApi() {
  return {
    name: 'agorababel-analyze-api',
    configureServer(server) {
      server.middlewares.use('/api/runtime-status', (request, response) => {
        void handleRuntimeStatusRequest(request, response)
      })
      server.middlewares.use('/api/analyze/stream', (request, response) => {
        void handleAnalyzeStreamRequest(request, response)
      })
      server.middlewares.use('/api/analyze', (request, response) => {
        void handleAnalyzeRequest(request, response)
      })
      server.middlewares.use('/api/events', (request, response) => {
        void handleEventsRequest(request, response)
      })
      server.middlewares.use('/api/markets', (request, response) => {
        void handleMarketIntelligenceRequest(request, response)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value
  }

  return {
    plugins: [
      analyzeApi(),
      figmaAssetResolver(),
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used – do not remove them
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        // Alias @ to the src directory
        '@': path.resolve(__dirname, './src'),
      },
    },

    // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
    assetsInclude: ['**/*.svg', '**/*.csv'],
  }
})
