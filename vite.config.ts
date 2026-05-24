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
      const apiHandler = (handler, routeStage) => (request, response) => {
        Promise.resolve(handler(request, response)).catch((error) => {
          server.config.logger.error(error)

          if (response.writableEnded) return
          if (response.headersSent) {
            response.end()
            return
          }

          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json;charset=utf-8')
          response.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Analysis failed.',
            stage: routeStage,
            likelyCause: 'The API middleware failed before the no-fallback stage handler could return a structured result.',
            details: ['Inspect the dev server console for the original backend exception.'],
          }))
        })
      }

      server.middlewares.use('/api/runtime-status', apiHandler(handleRuntimeStatusRequest, 'runtime-config'))
      server.middlewares.use('/api/analyze/stream', apiHandler(handleAnalyzeStreamRequest, 'api'))
      server.middlewares.use('/api/analyze', apiHandler(handleAnalyzeRequest, 'api'))
      server.middlewares.use('/api/events', apiHandler(handleEventsRequest, 'events'))
      server.middlewares.use('/api/markets', apiHandler(handleMarketIntelligenceRequest, 'x402-publication'))
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
