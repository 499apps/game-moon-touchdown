import { kitPlaywrightConfig } from './src/kit/smoke/projects';

// Standalone game, served by `vite preview` at http://localhost:4176/games/moon-touchdown/.
export default kitPlaywrightConfig({
  testDir: './e2e',
  testMatch: 'smoke.spec.ts',
  port: 4176,
  serverCommand: 'pnpm exec vite preview --port {port} --strictPort',
  readyPath: '/games/moon-touchdown/',
});
