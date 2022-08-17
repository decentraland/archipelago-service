import { createLogComponent } from '@well-known-components/logger'
import { createLocalNatsComponent } from '@well-known-components/nats-component'
import { IslandChangedMessage, JoinIslandMessage, LeftIslandMessage } from '../../src/controllers/proto/archipelago'
import { setupPublishing } from '../../src/controllers/publish'
import { Island, UpdateSubscriber } from '../../src/types'

describe('publishing', () => {
  it('should publish island changed messages', async () => {
    const nats = await createLocalNatsComponent()
    const logs = await createLogComponent({})

    const transportRegistry = {
      async getConnectionString(transportId: number, userId: string, roomId: string): Promise<string> {
        return `${transportId}:${userId}:${roomId}`
      }
    }

    const island: Island = {
      id: 'i1',
      maxPeers: 100,
      center: [0, 0, 0],
      radius: 100,
      sequenceId: 0,
      peers: [
        { id: 'peer2', position: [0, 0, 0] },
        { id: 'peer3', position: [0, 0, 0] }
      ],
      transportId: 0,
      _geometryDirty: false,
      _recalculateGeometryIfNeeded: () => {}
    }

    let registeredSubscriber: UpdateSubscriber | undefined = undefined
    const archipelago = {
      subscribeToUpdates(subscriber: UpdateSubscriber) {
        registeredSubscriber = subscriber
      },
      getIsland(_: string): Island {
        return island
      }
    }

    await setupPublishing({ nats, archipelago, logs, transportRegistry })

    expect(registeredSubscriber).toBeTruthy()

    const peerSubscription = nats.subscribe('client-proto.peer1.island_changed')
    const islandSubscription = nats.subscribe('client-proto.island.i1.peer_join')

    await registeredSubscriber({
      peer1: {
        action: 'changeTo',
        islandId: island.id,
        transportId: 0
      }
    })

    for await (const message of peerSubscription.generator) {
      const m = IslandChangedMessage.decode(message.data)
      expect(m).toEqual(
        expect.objectContaining({
          fromIslandId: undefined,
          islandId: island.id,
          connStr: `0:peer1:${island.id}`,
          peers: {
            peer2: { x: 0, y: 0, z: 0 },
            peer3: { x: 0, y: 0, z: 0 }
          }
        })
      )
      break
    }
    for await (const message of islandSubscription.generator) {
      const m = JoinIslandMessage.decode(message.data)
      expect(m.islandId).toEqual(island.id)
      expect(m.peerId).toEqual('peer1')
      break
    }
  })

  it('should publish island island left', async () => {
    const nats = await createLocalNatsComponent()
    const logs = await createLogComponent({})

    const transportRegistry = {
      async getConnectionString(transportId: number, userId: string, roomId: string): Promise<string> {
        return `${transportId}:${userId}:${roomId}`
      }
    }

    let registeredSubscriber: UpdateSubscriber | undefined = undefined
    const archipelago = {
      subscribeToUpdates(subscriber: UpdateSubscriber) {
        registeredSubscriber = subscriber
      },
      getIsland(_: string) {
        return undefined
      }
    }

    await setupPublishing({ nats, archipelago, logs, transportRegistry })

    expect(registeredSubscriber).toBeTruthy()

    const islandSubscription = nats.subscribe('client-proto.island.i1.peer_left')

    await registeredSubscriber({
      peer1: {
        action: 'leave',
        islandId: 'i1'
      }
    })

    for await (const message of islandSubscription.generator) {
      const m = LeftIslandMessage.decode(message.data)
      expect(m).toEqual(
        expect.objectContaining({
          islandId: 'i1',
          peerId: 'peer1'
        })
      )
      break
    }
  })
})
