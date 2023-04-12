import { encodeJson } from '@well-known-components/nats-component'
import { BaseComponents, Island } from '../types'
import { IslandStatusMessage, IslandData } from '@dcl/protocol/out-js/decentraland/kernel/comms/v3/archipelago.gen'

import { IBaseComponent } from '@well-known-components/interfaces'

export type ServiceDiscoveryMessage = {
  serverName: string
  status: any
}

export type IPublisherComponent = IBaseComponent & {
  publishServiceDiscoveryMessage(): void
  publishIslandsReport(islands: Island[]): void
}

export async function createPublisherComponent({
  nats,
  config,
  peersRegistry
}: Pick<BaseComponents, 'config' | 'nats' | 'peersRegistry'>): Promise<IPublisherComponent> {
  const commitHash = await config.getString('COMMIT_HASH')

  function publishServiceDiscoveryMessage() {
    const status = {
      currentTime: Date.now(),
      commitHash,
      userCount: peersRegistry.getPeerCount()
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
    publishServiceDiscoveryMessage,
    publishIslandsReport
  }
}
