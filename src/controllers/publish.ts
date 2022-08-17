import { ITransportRegistryComponent } from '../ports/transport-registry'
import { AppComponents, ArchipelagoComponent, IslandUpdates, PeerData } from '../types'
import { IslandChangedMessage, JoinIslandMessage, LeftIslandMessage } from './proto/archipelago'

type Components = Pick<AppComponents, 'nats' | 'logs'> & {
  archipelago: Pick<ArchipelagoComponent, 'subscribeToUpdates' | 'getIsland'>
  transportRegistry: Pick<ITransportRegistryComponent, 'getConnectionString'>
}

export async function setupPublishing({ nats, logs, archipelago, transportRegistry }: Components) {
  const logger = logs.getLogger('publishing controller')

  archipelago.subscribeToUpdates(async (updates: IslandUpdates) => {
    // Prevent processing updates if there are no changes
    if (!Object.keys(updates).length) {
      return
    }

    Object.keys(updates).forEach(async (peerId) => {
      const update = updates[peerId]
      if (update.action === 'changeTo') {
        const island = archipelago.getIsland(update.islandId)
        if (!island) {
          return
        }

        const connStr = await transportRegistry.getConnectionString(update.transportId, peerId, update.islandId)

        if (!connStr) {
          // TODO(hugo): this a big problem, there is an inconsistency between the state archipelago has (the worker) and the reality
          logger.error(`Unhandled error: cannot get connection string for transport ${update.transportId}`)
          return
        }

        const islandChangedMessage: IslandChangedMessage = {
          islandId: update.islandId,
          connStr: connStr,
          peers: {}
        }

        island.peers.forEach((peerData: PeerData) => {
          islandChangedMessage.peers[peerData.id] = {
            x: peerData.position[0],
            y: peerData.position[1],
            z: peerData.position[2]
          }
        })
        if (update.fromIslandId) {
          islandChangedMessage.fromIslandId = update.fromIslandId
        }
        nats.publish(
          `client-proto.${peerId}.island_changed`,
          IslandChangedMessage.encode(islandChangedMessage).finish()
        )

        nats.publish(
          `client-proto.island.${update.islandId}.peer_join`,
          JoinIslandMessage.encode({
            islandId: update.islandId,
            peerId
          }).finish()
        )
      } else if (update.action === 'leave') {
        nats.publish(
          `client-proto.island.${update.islandId}.peer_left`,
          LeftIslandMessage.encode({
            islandId: update.islandId,
            peerId
          }).finish()
        )
      }
    })
  })
}
