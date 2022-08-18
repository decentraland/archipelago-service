import { AppComponents, IslandUpdates, PeerData } from '../types'
import { ArchipelagoController } from './archipelago'
import { IslandChangedMessage, JoinIslandMessage, LeftIslandMessage } from './proto/archipelago'

export async function setupPublishing(
  archipelago: Pick<ArchipelagoController, 'subscribeToUpdates' | 'getIsland'>,
  { nats }: Pick<AppComponents, 'nats'>
) {
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

        const islandChangedMessage: IslandChangedMessage = {
          islandId: update.islandId,
          connStr: update.connStr,
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
