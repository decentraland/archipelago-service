import { Reader } from 'protobufjs/minimal'
import { AppComponents, PeerPositionChange } from '../types'
import { ArchipelagoController } from './archipelago'
import { HeartbeatMessage } from './proto/archipelago'

export async function setupListener(
  archipelago: Pick<ArchipelagoController, 'onPeersRemoved' | 'onPeerPositionsUpdate'>,
  { nats, logs, config }: Pick<AppComponents, 'nats' | 'logs' | 'config'>
) {
  const checkHeartbeatInterval = await config.requireNumber('CHECK_HEARTBEAT_INTERVAL')
  const logger = logs.getLogger('NATS listener')

  const lastPeerHeartbeats = new Map<string, number>()

  // Clear peers that did not send heartbeats in the required interval
  const peerExpirationInterval = setInterval(() => {
    const expiredHeartbeatTime = Date.now() - checkHeartbeatInterval

    const inactivePeers = Array.from(lastPeerHeartbeats)
      .filter(([_, lastHearbeat]) => lastHearbeat < expiredHeartbeatTime)
      .map(([peerId, _]) => peerId)

    inactivePeers.forEach((peerId) => lastPeerHeartbeats.delete(peerId))
    archipelago.onPeersRemoved(inactivePeers)
  }, checkHeartbeatInterval)

  const connectSubscription = nats.subscribe('peer.*.connect')
  ;(async () => {
    for await (const message of connectSubscription.generator) {
      try {
        const id = message.subject.split('.')[1]
        archipelago.onPeersRemoved([id])
      } catch (err: any) {
        logger.error(`cannot process peer_connect message ${err.message}`)
      }
    }
  })().catch((err: any) => logger.error(`error processing subscription message; ${err.message}`))

  const disconnectSubscription = nats.subscribe('peer.*.disconnect')
  ;(async () => {
    for await (const message of disconnectSubscription.generator) {
      try {
        const id = message.subject.split('.')[1]
        archipelago.onPeersRemoved([id])
      } catch (err: any) {
        logger.error(`cannot process peer_disconnect message ${err.message}`)
      }
    }
  })().catch((err: any) => logger.error(`error processing subscription message; ${err.message}`))

  const heartbeatSubscription = nats.subscribe('client-proto.peer.*.heartbeat')
  ;(async () => {
    for await (const message of heartbeatSubscription.generator) {
      try {
        const id = message.subject.split('.')[2]
        const decodedMessage = HeartbeatMessage.decode(Reader.create(message.data))
        const position = decodedMessage.position!

        const peerPositionChange: PeerPositionChange = {
          id,
          position: [position.x, position.y, position.z]
        }

        lastPeerHeartbeats.set(peerPositionChange.id, Date.now())
        archipelago.onPeerPositionsUpdate([peerPositionChange])
      } catch (err: any) {
        logger.error(`cannot process heartbeat message ${err.message}`)
      }
    }
  })().catch((err: any) => logger.error(`error processing subscription message; ${err.message}`))

  return {
    stop: () => clearInterval(peerExpirationInterval)
  }
}
