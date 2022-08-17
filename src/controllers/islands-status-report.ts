import { ArchipelagoController } from '../controllers/archipelago'
import { AppComponents } from '../types'
import { IslandStatusMessage, IslandData } from './proto/archipelago'

const DEFAULT_ARCHIPELAGO_ISLANDS_STATUS_UPDATE_INTERVAL = 1000 * 60 * 2 // 2 min

export async function setupIslandsStatusReporting(
  archipelago: Pick<ArchipelagoController, 'getIslands'>,
  { nats, logs, config }: Pick<AppComponents, 'nats' | 'logs' | 'config'>
) {
  const logger = logs.getLogger('Islands status report')

  const islandsStatusUpdateIntervalFreq =
    (await config.getNumber('ARCHIPELAGO_ISLANDS_STATUS_UPDATE_INTERVAL')) ??
    DEFAULT_ARCHIPELAGO_ISLANDS_STATUS_UPDATE_INTERVAL

  async function publishReport() {
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

  async function start() {
    setInterval(async () => {
      try {
        await publishReport()
      } catch (err: any) {
        logger.error(err)
      }
    }, islandsStatusUpdateIntervalFreq)
  }

  return {
    start,
    publishReport
  }
}
