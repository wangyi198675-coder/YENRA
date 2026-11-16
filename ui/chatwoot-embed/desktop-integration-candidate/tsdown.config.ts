import { resolve } from 'node:path'
import { clientBundle } from '../../../upstream/official-source/packages/client/tsdown.client.ts'
// Source mode, Client only: retain installed Host lib/index.js byte-identically.
const preset = clientBundle(import.meta.dirname, ['src/index.ts'])
export default () => preset({ env: {} }).slice(1).map(config => ({
  ...config,
  // Relocated candidate needs a build-only alias, not edits to original helpers.
  alias: {
    '../../../../upstream/official-source': resolve(import.meta.dirname, '../../../upstream/official-source'),
    '../../../../social-adapters': resolve(import.meta.dirname, '../../../social-adapters'),
  },
}))
