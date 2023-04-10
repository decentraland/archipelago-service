import { encodeJson } from '@well-known-components/nats-component'
import { TemplatedApp } from 'uWebSockets.js'

import { BaseComponents, ChangeToIslandUpdate, PeerData, Island } from '../types'
import {
  IslandChangedMessage,
  IslandStatusMessage,
  IslandData
} from '@dcl/protocol/out-js/decentraland/kernel/comms/v3/archipelago.gen'

import { IBaseComponent } from '@well-known-components/interfaces'
import { craftMessage } from '../logic/craft-message'

export type ServiceDiscoveryMessage = {
  serverName: string
  status: any
}

export type IPublisherComponent = IBaseComponent & {
  onChangeToIsland(peerId: string, island: Island, change: ChangeToIslandUpdate): void
  onPeerLeft(peerId: string, islandId: string): void
  publishServiceDiscoveryMessage(): void
  publishIslandsReport(islands: Island[]): void
}

export async function createPublisherComponent(
  { nats, config, peersRegistry }: Pick<BaseComponents, 'config' | 'nats' | 'peersRegistry'>,
  uws: TemplatedApp
): Promise<IPublisherComponent> {
  const commitHash = await config.getString('COMMIT_HASH')

  function onChangeToIsland(peerId: string, toIsland: Island, update: ChangeToIslandUpdate) {
    const islandChangedMessage: IslandChangedMessage = {
      islandId: update.islandId,
      connStr: update.connStr,
      peers: {}
    }

    toIsland.peers.forEach((peerData: PeerData) => {
      islandChangedMessage.peers[peerData.id] = {
        x: peerData.position[0],
        y: peerData.position[1],
        z: peerData.position[2]
      }
    })
    if (update.fromIslandId) {
      islandChangedMessage.fromIslandId = update.fromIslandId
    }

    uws.publish(
      `island.${update.islandId}`,
      craftMessage({
        message: {
          $case: 'joinIsland',
          joinIsland: {
            islandId: update.islandId,
            peerId: peerId
          }
        }
      }),
      true
    )

    const ws = peersRegistry.getPeerWs(peerId)
    if (ws) {
      if (update.fromIslandId) {
        ws.unsubscribe(`island.${update.fromIslandId}`)
      }

      ws.subscribe(`island.${update.islandId}`)

      ws.send(
        craftMessage({
          message: {
            $case: 'islandChanged',
            islandChanged: islandChangedMessage
          }
        }),
        true
      )
    }
  }

  function onPeerLeft(peerId: string, islandId: string) {
    uws.publish(
      `island.${islandId}`,
      craftMessage({
        message: {
          $case: 'leftIsland',
          leftIsland: {
            islandId: islandId,
            peerId: peerId
          }
        }
      }),
      true
    )
  }

  function publishServiceDiscoveryMessage() {
    const status = {
      currentTime: Date.now(),
      commitHash
    }
    const serviceDiscoveryMessage: ServiceDiscoveryMessage = {
      serverName: 'archipelago',
      status
    }
    const encodedMsg = encodeJson(serviceDiscoveryMessage)
    nats.publish('service.discovery', encodedMsg)
  }

  function publishIslandsReport(islands: Island[]) {
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
    onChangeToIsland,
    onPeerLeft,
    publishServiceDiscoveryMessage,
    publishIslandsReport
  }
}
