import { IBaseComponent } from '@well-known-components/interfaces'
import { Transport } from '../types'

export type ITransportRegistryComponent = IBaseComponent & {
  onTransportConnected(transport: Transport): void
  onTransportDisconnected(id: number): void
  getTransports(): Map<number, Transport>
}

export async function createTransportRegistryComponent(): Promise<ITransportRegistryComponent> {
  const availableTransports = new Map<number, Transport>()

  function onTransportConnected(transport: Transport) {
    availableTransports.set(transport.id, transport)
  }

  function onTransportDisconnected(id: number) {
    availableTransports.delete(id)
  }

  function getTransports() {
    return availableTransports
  }

  return {
    onTransportConnected,
    onTransportDisconnected,
    getTransports
  }
}
