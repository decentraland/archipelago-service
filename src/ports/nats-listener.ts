import { IBaseComponent } from '@well-known-components/interfaces'
import { BaseComponents, PeerPositionChange } from '../types'
import { HeartbeatMessage } from '../controllers/proto/archipelago'
import { Reader } from 'protobufjs/minimal'

export type INatsListenerComponent = IBaseComponent & {
  init: () => Promise<void>
}

export async function createNatsListenerComponent(
  components: Pick<BaseComponents, 'logs' | 'nats' | 'archipelago' | 'config'>
): Promise<INatsListenerComponent> {
  const { nats, config, archipelago, logs } = components

  const checkHeartbeatInterval = await config.requireNumber('CHECK_HEARTBEAT_INTERVAL')
  const logger = logs.getLogger('NATS listener component')

  const lastPeerHeartbeats = new Map<string, number>()

  async function init() {
    // Clear peers that did not send heartbeats in the required interval
    setInterval(() => {
      const expiredHeartbeatTime = Date.now() - checkHeartbeatInterval

      const inactivePeers = Array.from(lastPeerHeartbeats)
        .filter(([_, lastHearbeat]) => lastHearbeat < expiredHeartbeatTime)
        .map(([peerId, _]) => peerId)

      inactivePeers.forEach((peerId) => lastPeerHeartbeats.delete(peerId))
      archipelago.clearPeers(...inactivePeers)
    }, checkHeartbeatInterval)

    const connectSubscription = nats.subscribe('peer.*.connect')
    ;(async () => {
      for await (const message of connectSubscription.generator) {
        try {
          const id = message.subject.split('.')[1]
          archipelago.clearPeers(id)
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
          archipelago.clearPeers(id)
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
          archipelago.setPeersPositions(peerPositionChange)
        } catch (err: any) {
          logger.error(`cannot process heartbeat message ${err.message}`)
        }
      }
    })().catch((err: any) => logger.error(`error processing subscription message; ${err.message}`))
  }

  return {
    init
  }
}
