import { AppComponents, ServiceDiscoveryMessage } from '../types'
import { JSONCodec } from '@well-known-components/nats-component'

export async function setupServiceDiscovery({ nats, config }: Pick<AppComponents, 'nats' | 'config'>) {
  const jsonCodec = JSONCodec()
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
    const encodedMsg = jsonCodec.encode(serviceDiscoveryMessage)
    nats.publish('service.discovery', encodedMsg)
  }

  return {
    publishMessage
  }
}
