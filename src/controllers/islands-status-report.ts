import { ArchipelagoController } from '../controllers/archipelago'
import { AppComponents } from '../types'
import { IslandStatusMessage, IslandData } from './proto/archipelago'

export async function setupIslandsStatusReporting(
  archipelago: Pick<ArchipelagoController, 'getIslands'>,
  { nats }: Pick<AppComponents, 'nats'>
) {
  function publishReport() {
    const islands = archipelago.getIslands()
    const data: IslandData[] = islands.map((i) => {
      return {
        id: i.id,
        center: {
          x: i.center[0],
          y: i.center[1],
          z: i.center[2]
        },
        maxPeers: i.maxPeers,
        radius: i.radius,
        peers: i.peers.map((p) => p.id)
      }
    })
    const message = IslandStatusMessage.encode({ data }).finish()
    nats.publish('archipelago.islands', message)
  }

  return {
    publishReport
  }
}
