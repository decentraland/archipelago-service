import { IBaseComponent } from '@well-known-components/interfaces'
import { InternalWebSocket, PeerPositionChange } from '../types'

export type PeersAdapter = {
  onPeerDisconnected(id: string): void
  onPeerPositionsUpdate(changes: PeerPositionChange[]): void
}

export type IPeersRegistryComponent = IBaseComponent &
  PeersAdapter & {
    onPeerConnected(id: string, ws: InternalWebSocket): void
    setAdapter(l: PeersAdapter): void
    getPeerWs(id: string): InternalWebSocket | undefined
  }

export async function createPeersRegistry(): Promise<IPeersRegistryComponent> {
  let adapter: PeersAdapter | undefined = undefined

  const connectedPeers = new Map<string, InternalWebSocket>()

  function onPeerConnected(id: string, ws: InternalWebSocket): void {
    connectedPeers.set(id, ws)
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

  function getPeerWs(id: string): InternalWebSocket | undefined {
    return connectedPeers.get(id)
  }

  function setAdapter(l: PeersAdapter) {
    adapter = l
  }

  return {
    onPeerConnected,
    onPeerDisconnected,
    onPeerPositionsUpdate,
    getPeerWs,
    setAdapter
  }
}
