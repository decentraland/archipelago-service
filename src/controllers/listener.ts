import { Heartbeat } from '@dcl/protocol/out-js/decentraland/kernel/comms/v3/archipelago.gen'
import { AppComponents, PeerPositionChange } from '../types'
import { ArchipelagoController } from './archipelago'

export async function setupListener(
  archipelago: Pick<ArchipelagoController, 'onPeerDisconnected' | 'onPeerPositionsUpdate'>,
  { nats, logs, config }: Pick<AppComponents, 'nats' | 'logs' | 'config'>
) {
  const checkHeartbeatInterval = await config.requireNumber('CHECK_HEARTBEAT_INTERVAL')
  const logger = logs.getLogger('NATS listener')

  const lastPeerHeartbeats = new Map<string, number>()

  // Clear peers that did not send heartbeats in the required interval
  const peerExpirationInterval = setInterval(() => {
    const expiredHeartbeatTime = Date.now() - checkHeartbeatInterval

    for (const [peerId, lastHeartbeat] of lastPeerHeartbeats) {
      if (lastHeartbeat < expiredHeartbeatTime) {
        lastPeerHeartbeats.delete(peerId)
        archipelago.onPeerDisconnected(peerId)
      }
    }
  }, checkHeartbeatInterval)

  // NOTE we are using callbacks instead of async, for NATS subscriptions
  // there are some risk associated with this pattern so we should keep the callbacks small and fast
  // see https://github.com/nats-io/nats.js/#async-vs-callbacks

  nats.subscribe('peer.*.connect', (err, message) => {
    if (err) {
      logger.error(err)
      return
    }

    try {
      const id = message.subject.split('.')[1]
      archipelago.onPeerDisconnected(id)
    } catch (err: any) {
      logger.error(`cannot process peer_connect message ${err.message}`)
    }
  })

  nats.subscribe('peer.*.disconnect', (err, message) => {
    if (err) {
      logger.error(err)
      return
    }

    try {
      const id = message.subject.split('.')[1]
      archipelago.onPeerDisconnected(id)
    } catch (err: any) {
      logger.error(`cannot process peer_disconnect message ${err.message}`)
    }
  })

  nats.subscribe('client-proto.peer.*.heartbeat', (err, message) => {
    if (err) {
      logger.error(err)
      return
    }

    try {
      const id = message.subject.split('.')[2]
      const decodedMessage = Heartbeat.decode(message.data)
      const position = decodedMessage.position!

      const peerPositionChange: PeerPositionChange = {
        id,
        position: [position.x, position.y, position.z],
        preferedIslandId: decodedMessage.desiredRoom
      }

      lastPeerHeartbeats.set(peerPositionChange.id, Date.now())
      archipelago.onPeerPositionsUpdate([peerPositionChange])
    } catch (err: any) {
      logger.error(`cannot process heartbeat message ${err.message}`)
    }
  })

  return {
    stop: () => clearInterval(peerExpirationInterval)
  }
}
