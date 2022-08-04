import { IBaseComponent } from '@well-known-components/interfaces'
import { BaseComponents } from '../types'
import { IslandUpdates, PeerData, ServiceDiscoveryMessage } from '../types'
import {
  IslandChangedMessage,
  LeftIslandMessage,
  JoinIslandMessage,
  IslandStatusMessage,
  IslandData
} from '../controllers/proto/archipelago'
import { JSONCodec } from '@well-known-components/nats-component'

const ARCHIPELAGO_ISLANDS_STATUS_UPDATE_INTERVAL = 1000 * 60 * 2 // 2 min

export type IReportOverNatsComponent = IBaseComponent & {
  init: () => Promise<void>
  stop: () => Promise<void>
}

export async function createReportOverNatsComponent(
  components: Pick<BaseComponents, 'logs' | 'nats' | 'config' | 'archipelagoStatus'>
): Promise<IReportOverNatsComponent> {
  const { nats, archipelagoStatus, config, logs } = components

  const commitHash = await config.getString('COMMIT_HASH')
  const serviceUpdateIntervalFreq = await config.requireNumber('ARCHIPELAGO_STATUS_UPDATE_INTERVAL')
  const logger = logs.getLogger('Report over NATS component')
  const jsonCodec = JSONCodec()

  let serviceDiscoveryInterval: undefined | NodeJS.Timer = undefined
  let islandsReportInterval: undefined | NodeJS.Timer = undefined

  async function init() {
    serviceDiscoveryInterval = setInterval(async () => {
      try {
        const status = {
          currenTime: Date.now(),
          commitHash
        }
        const serviceDiscoveryMessage: ServiceDiscoveryMessage = {
          serverName: 'archipelago',
          status
        }
        const encodedMsg = jsonCodec.encode(serviceDiscoveryMessage)
        nats.publish('service.discovery', encodedMsg)
      } catch (err: any) {
        logger.error(err)
      }
    }, serviceUpdateIntervalFreq)

    islandsReportInterval = setInterval(async () => {
      try {
        const islands = await archipelagoStatus.getIslands()
        const data: IslandData[] = islands.map((i) => {
          return {
            id: i.id,
            center: {
              x: i.center[0],
              y: i.center[1],
              z: i.center[2]
            },
            maxPeers: 100,
            radius: i.radius,
            peers: i.peers.map((p) => p.id)
          }
        })
        const message = IslandStatusMessage.encode({ data }).finish()
        nats.publish('archipelago.islands', message)
      } catch (err: any) {
        logger.error(err)
      }
    }, ARCHIPELAGO_ISLANDS_STATUS_UPDATE_INTERVAL)

    archipelagoStatus.subscribeToUpdates(async (updates: IslandUpdates) => {
      // Prevent processing updates if there are no changes
      if (!Object.keys(updates).length) {
        return
      }

      Object.keys(updates).forEach(async (peerId) => {
        const update = updates[peerId]

        if (update.action === 'changeTo') {
          const island = await archipelagoStatus.getIsland(update.islandId)
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

  async function stop() {
    if (serviceDiscoveryInterval) {
      clearInterval(serviceDiscoveryInterval)
    }

    if (islandsReportInterval) {
      clearInterval(islandsReportInterval)
    }
  }

  return {
    init,
    stop
  }
}
