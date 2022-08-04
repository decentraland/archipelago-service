import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createLocalNatsComponent } from '@well-known-components/nats-component'
import { createNatsListenerComponent } from '../../src/ports/nats-listener'
import { PeerPositionChange } from '../../src/types'

describe('nats listener', () => {
  it('ok', async () => {
    const logs = await createLogComponent({})
    const config = createConfigComponent({
      CHECK_HEARTBEAT_INTERVAL: '100'
    })
    const nats = await createLocalNatsComponent()
    const archipelago = {
      clearPeers(...ids: string[]): void {},
      setPeersPositions(...requests: PeerPositionChange[]): void {}
    }

    const listener = await createNatsListenerComponent({ logs, nats, archipelago, config })
  })
})
