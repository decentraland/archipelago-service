import { IBaseComponent } from '@well-known-components/interfaces'
import { Transport } from '../types'

export type TransportAdapter = {
  onTransportHeartbeat(transport: Transport): void
  onTransportDisconnected(id: number): void
}

export type ITransportRegistryComponent = IBaseComponent &
  TransportAdapter & {
    setAdapter(adapter: TransportAdapter): void
  }

export async function createTransportRegistryComponent(): Promise<ITransportRegistryComponent> {
  let adapter: TransportAdapter | undefined = undefined

  function onTransportHeartbeat(transport: Transport) {
    if (!adapter) {
      throw new Error('No adapter defined')
    }
    adapter.onTransportHeartbeat(transport)
  }

  function onTransportDisconnected(id: number) {
    if (!adapter) {
      throw new Error('No adapter defined')
    }
    adapter.onTransportDisconnected(id)
  }

  function setAdapter(l: TransportAdapter) {
    adapter = l
  }

  return {
    onTransportHeartbeat,
    onTransportDisconnected,
    setAdapter
  }
}
