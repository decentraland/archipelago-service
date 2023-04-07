import { IBaseComponent } from '@well-known-components/interfaces'
import { PeerPositionChange } from '../types'

export type PeersAdapter = {
  onPeerRemoved(id: string): void
  onPeerPositionsUpdate(changes: PeerPositionChange[]): void
  isPeerConnected(id: string): boolean
}

export type IPeersRegistryComponent = IBaseComponent &
  PeersAdapter & {
    setAdapter(l: PeersAdapter): void
  }

export async function createPeersRegistry(): Promise<IPeersRegistryComponent> {
  let adapter: PeersAdapter | undefined = undefined

  function onPeerRemoved(id: string): void {
    if (!adapter) {
      throw new Error('No adapter defined')
    }
    adapter.onPeerRemoved(id)
  }

  function onPeerPositionsUpdate(changes: PeerPositionChange[]): void {
    if (!adapter) {
      throw new Error('No adapter defined')
    }

    adapter.onPeerPositionsUpdate(changes)
  }

  function isPeerConnected(id: string): boolean {
    if (!adapter) {
      throw new Error('No adapter defined')
    }

    return adapter.isPeerConnected(id)
  }

  function setAdapter(l: PeersAdapter) {
    adapter = l
  }

  return {
    onPeerRemoved,
    onPeerPositionsUpdate,
    isPeerConnected,
    setAdapter
  }
}
