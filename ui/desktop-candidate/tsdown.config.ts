import { clientBundle } from '../../upstream/official-source/packages/client/tsdown.client.ts'
export default clientBundle(import.meta.dirname, ['src/index.ts'])
