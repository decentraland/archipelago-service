import { Reader } from 'protobufjs/minimal'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLocalNatsComponent, decodeJson } from '@well-known-components/nats-component'
import { IslandStatusMessage } from '@dcl/protocol/out-js/decentraland/kernel/comms/v3/archipelago.gen'
import { createPublisherComponent, ServiceDiscoveryMessage } from '../../src/adapters/publisher'
import { Island } from '../../src/types'
import { INatsComponent, NatsMsg } from '@well-known-components/nats-component/dist/types'
import { createPeersRegistry } from '../../src/adapters/peers-registry'

function takeOneSubscription(nats: INatsComponent, topic: string) {
  return new Promise<NatsMsg>((resolve, reject) => {
    nats.subscribe(topic, (err, message) => {
      if (err) {
        return reject(err)
      }

      resolve(message)
    })
  })
}

describe('publishing', () => {
  const commitHash = '1234456'
  const config = createConfigComponent({
    COMMIT_HASH: commitHash
  })

  it('should publish to service discovery', async () => {
    const now = Date.now()
    Date.now = jest.fn(() => now)
    const nats = await createLocalNatsComponent()
    const s = takeOneSubscription(nats, 'service.discovery')
    const peersRegistry = await createPeersRegistry({
      publish: (_topic: string, _payload: Uint8Array, _binary: boolean) => {}
    })
    const { publishServiceDiscoveryMessage } = await createPublisherComponent({ nats, config, peersRegistry })
    publishServiceDiscoveryMessage()
    const message = await s
    const data: ServiceDiscoveryMessage = decodeJson(message.data) as any
    expect(data).toEqual(
      expect.objectContaining({
        serverName: 'archipelago',
        status: {
          currentTime: now,
          commitHash,
          userCount: 0
        }
      })
    )
  })
  it('should publish island status ', async () => {
    const nats = await createLocalNatsComponent()
    const islands: Island[] = [
      {
        id: 'I1',
        center: [0, 0, 0],
        radius: 100,
        maxPeers: 100,
        peers: [],
        sequenceId: 10,
        transportId: 0,
        _geometryDirty: false
      }
    ]
    const s = takeOneSubscription(nats, 'archipelago.islands')
    const peersRegistry = await createPeersRegistry({
      publish: (_topic: string, _payload: Uint8Array, _binary: boolean) => {}
    })
    const { publishIslandsReport } = await createPublisherComponent({ nats, config, peersRegistry })
    publishIslandsReport(islands)
    const message = await s
    const { data } = IslandStatusMessage.decode(Reader.create(message.data))
    expect(data).toHaveLength(1)
    expect(data).toEqual(
      expect.arrayContaining([
        {
          id: 'I1',
          peers: [],
          maxPeers: 100,
          center: {
            x: 0,
            y: 0,
            z: 0
          },
          radius: 100
        }
      ])
    )
  })
})
