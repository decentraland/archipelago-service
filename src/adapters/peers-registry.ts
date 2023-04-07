import { IBaseComponent } from '@well-known-components/interfaces'
import { PeerPositionChange } from '../types'

export type PeersAdapter = {
  onPeerDisconnected(id: string): void
  onPeerPositionsUpdate(changes: PeerPositionChange[]): void
}

export type IPeersRegistryComponent = IBaseComponent &
  PeersAdapter & {
    onPeerConnected(id: string): void
    setAdapter(l: PeersAdapter): void
    isPeerConnected(id: string): boolean
  }

export async function createPeersRegistry(): Promise<IPeersRegistryComponent> {
  let adapter: PeersAdapter | undefined = undefined

  const connectedPeers = new Set<string>()

  function onPeerConnected(id: string): void {
    connectedPeers.add(id)
  }

  function onPeerDisconnected(id: string): void {
    if (!adapter) {
      throw new Error('No adapter defined')
    }
    connectedPeers.delete(id)
    adapter.onPeerDisconnected(id)
  }

  function onPeerPositionsUpdate(changes: PeerPositionChange[]): void {
    if (!adapter) {
      throw new Error('No adapter defined')
    }

    adapter.onPeerPositionsUpdate(changes)
  }

  function isPeerConnected(id: string): boolean {
    return connectedPeers.has(id)
  }

  function setAdapter(l: PeersAdapter) {
    adapter = l
  }

  return {
    onPeerConnected,
    onPeerDisconnected,
    onPeerPositionsUpdate,
    isPeerConnected,
    setAdapter
  }
}
