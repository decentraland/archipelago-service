import { AppComponents, ServiceDiscoveryMessage } from '../types'
import { encodeJson } from '@well-known-components/nats-component'

export async function setupServiceDiscovery({ nats, config }: Pick<AppComponents, 'nats' | 'config'>) {
  const commitHash = await config.getString('COMMIT_HASH')

  function publishMessage() {
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

  return {
    publishMessage
  }
}
