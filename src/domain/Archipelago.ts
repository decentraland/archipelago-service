import { sequentialIdGenerator } from '../misc/idGenerator'
import {
  Position3D,
  PeerData,
  ArchipelagoOptions,
  IslandUpdates,
  PeerPositionChange,
  Island,
  ArchipelagoParameters,
  UpdatableArchipelagoParameters,
  Transport,
  ArchipelagoMetrics
} from '../interfaces'
import { findMax, popMax } from '../misc/utils'
import { IArchipelago } from './interfaces'
import { AccessToken } from 'livekit-server-sdk'
import * as jwt from 'jsonwebtoken'

const X_AXIS = 0
const Z_AXIS = 2

const parcelSize = 16

const squaredDistance = (p1: Position3D, p2: Position3D) => {
  // By default, we use XZ plane squared distance. We ignore "height"
  const xDiff = p2[X_AXIS] - p1[X_AXIS]
  const zDiff = p2[Z_AXIS] - p1[Z_AXIS]

  return xDiff * xDiff + zDiff * zDiff
}

export function defaultOptions() {
  return {
    maxPeersPerIsland: 200,
    islandIdGenerator: sequentialIdGenerator('I')
  }
}

function islandGeometryCalculator(peers: PeerData[]): [Position3D, number] {
  if (peers.length === 0) return [[0, 0, 0], 0]
  const sum = peers.reduce<Position3D>(
    (current, peer) => [current[X_AXIS] + peer.position[X_AXIS], 0, current[Z_AXIS] + peer.position[Z_AXIS]],
    [0, 0, 0]
  )

  const center = sum.map((it) => it / peers.length) as Position3D
  const farthest = findMax(peers, (peer) => squaredDistance(peer.position, center))!

  const radius = Math.sqrt(squaredDistance(farthest.position, center))

  return [center, radius]
}

function squared(n: number) {
  return n * n
}

type InternalIsland = Island & {
  _center?: Position3D
  _radius?: number
  _geometryDirty: boolean
  _recalculateGeometryIfNeeded: () => void
}

interface ConnectionGenerator {
  generate(peerId: string, islandId: string): string
}

class WsConnectionGenerator implements ConnectionGenerator {
  constructor(private url: string, private secret: string) {}

  generate(peerId: string, islandId: string): string {
    const token = jwt.sign({ peerId }, this.secret, {
      audience: this.url
    })

    return `ws-room:${this.url}/${islandId}?access_token=${token}`
  }
}

class LivekitConnectionGenerator implements ConnectionGenerator {
  constructor(private url: string, private apiKey: string, private apiSecret: string) {}

  generate(peerId: string, islandId: string): string {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: peerId
    })
    token.addGrant({ roomJoin: true, roomCreate: true, room: islandId })
    return `livekit:${this.url}?access_token=${token.toJwt()}`
  }
}

class P2PConnectionGenerator implements ConnectionGenerator {
  generate(peerId: string, islandId: string): string {
    return `p2p:${islandId}.${peerId}`
  }
}

export class Archipelago implements IArchipelago {
  private peers: Map<string, PeerData> = new Map()
  private islands: Map<string, InternalIsland> = new Map()

  private options: ArchipelagoOptions

  private currentSequence: number = 0

  private connectionGenerators = new Map<Transport, ConnectionGenerator>()

  private generateId(): string {
    return this.options.islandIdGenerator.generateId()
  }

  constructor(options: ArchipelagoParameters) {
    this.options = { ...defaultOptions(), ...options }

    if (this.options.livekit) {
      const generator = new LivekitConnectionGenerator(
        this.options.livekit.url,
        this.options.livekit.apiKey,
        this.options.livekit.apiSecret
      )
      this.connectionGenerators.set('livekit', generator)
    }

    if (this.options.wsRoomService) {
      const generator = new WsConnectionGenerator(this.options.wsRoomService.url, this.options.wsRoomService.secret)
      this.connectionGenerators.set('ws', generator)
    }

    this.connectionGenerators.set('p2p', new P2PConnectionGenerator())
  }

  modifyOptions(options: UpdatableArchipelagoParameters): IslandUpdates {
    this.options = { ...this.options, ...options }

    const updates: IslandUpdates = {}
    const allIslands = new Set(this.islands.keys())

    this.updateIslands(updates, allIslands)

    return updates
  }

  getOptions() {
    return this.options
  }

  /**
   * This returns a map containing the peers that left or changed island as keys, how they changed as values
   * */
  setPeersPositions(changes: PeerPositionChange[]): IslandUpdates {
    const updates: IslandUpdates = {}
    const affectedIslands: Set<string> = new Set()
    for (const change of changes) {
      const { id, position, preferedIslandId } = change
      if (!this.peers.has(id)) {
        this.peers.set(id, change)
        this.createIsland([this.peers.get(id)!], updates, affectedIslands)
      } else {
        const peer = this.peers.get(id)!
        peer.position = position

        // We can set the prefered island to undefined by explicitly providing the key but no value.
        // If we don't provide the key, we leave it as it is
        if ('preferedIslandId' in change) {
          peer.preferedIslandId = preferedIslandId
        }

        if (peer.islandId) {
          const island = this.getIsland(peer.islandId)!
          this.markGeometryDirty(island)
          affectedIslands.add(peer.islandId)
        }
      }
    }

    return this.updateIslands(updates, affectedIslands)
  }

  clearPeers(ids: string[]): IslandUpdates {
    const updates: IslandUpdates = {}
    const affectedIslands: Set<string> = new Set()
    for (const id of ids) {
      const peer = this.peers.get(id)

      if (peer) {
        this.peers.delete(id)
        if (peer.islandId) {
          this.clearPeerFromIsland(id, this.islands.get(peer.islandId)!)
          updates[peer.id] = { action: 'leave', islandId: peer.islandId }
          if (this.islands.has(peer.islandId)) {
            affectedIslands.add(peer.islandId)
          } else {
            affectedIslands.delete(peer.islandId)
          }
        }
      }
    }

    return this.updateIslands(updates, affectedIslands)
  }

  getPeerData(id: string): PeerData | undefined {
    return this.peers.get(id)
  }

  private clearPeerFromIsland(id: string, island: InternalIsland) {
    const idx = island.peers.findIndex((it) => it.id === id)
    if (idx >= 0) {
      island.peers.splice(idx, 1)
    }

    if (island.peers.length === 0) {
      this.islands.delete(island.id)
    }

    this.markGeometryDirty(island)
  }

  private updateIslands(updates: IslandUpdates, affectedIslands: Set<string>): IslandUpdates {
    updates = this.checkSplitIslands(updates, affectedIslands)
    return this.checkMergeIslands(updates, affectedIslands)
  }

  private checkSplitIslands(updates: IslandUpdates, affectedIslands: Set<string>): IslandUpdates {
    for (const islandId of affectedIslands) {
      this.checkSplitIsland(this.getIsland(islandId)!, updates, affectedIslands)
    }

    return updates
  }

  private checkMergeIslands(updates: IslandUpdates, affectedIslands: Set<string>): IslandUpdates {
    const processedIslands: Record<string, boolean> = {}

    for (const islandId of affectedIslands) {
      if (!processedIslands[islandId] && this.islands.has(islandId)) {
        const island = this.getIsland(islandId)!
        const islandsIntersected: InternalIsland[] = []
        for (const [, otherIsland] of this.islands) {
          if (islandId !== otherIsland.id && this.intersectIslands(island, otherIsland, this.options.joinDistance)) {
            islandsIntersected.push(otherIsland)
            processedIslands[islandId] = true
          }
        }
        if (islandsIntersected.length > 0) {
          updates = this.mergeIslands(updates, island, ...islandsIntersected)
        }
      }
    }

    return updates
  }

  private checkSplitIsland(island: InternalIsland, updates: IslandUpdates, affectedIslands: Set<string>) {
    const peerGroups: PeerData[][] = []

    for (const peer of island.peers) {
      const groupsIntersected = peerGroups.filter((it) => this.intersectPeerGroup(peer, it, this.options.leaveDistance))
      if (groupsIntersected.length === 0) {
        peerGroups.push([peer])
      } else {
        // We merge all the groups into one
        const [finalGroup, ...rest] = groupsIntersected
        finalGroup.push(peer)

        for (const group of rest) {
          // We remove each group
          peerGroups.splice(peerGroups.indexOf(group), 1)

          //We add the members of each group to the final group
          finalGroup.push(...group)
        }
      }
    }

    if (peerGroups.length > 1) {
      const biggestGroup = popMax(peerGroups, (group) => group.length)!
      island.peers = biggestGroup
      this.markGeometryDirty(island)

      for (const group of peerGroups) {
        this.createIsland(group, updates, affectedIslands)
      }
    }
  }

  private mergeIntoIfPossible(updates: IslandUpdates, islandToMergeInto: InternalIsland, anIsland: Island) {
    function canMerge(islandToMergeInto: Island, anIsland: Island) {
      return islandToMergeInto.peers.length + anIsland.peers.length <= islandToMergeInto.maxPeers
    }

    if (canMerge(islandToMergeInto, anIsland)) {
      updates = this.addPeersToIsland(islandToMergeInto, anIsland.peers, updates)

      this.islands.delete(anIsland.id)

      this.markGeometryDirty(islandToMergeInto)

      return true
    } else {
      return false
    }
  }

  private mergeIslands(updates: IslandUpdates, ...islands: InternalIsland[]): IslandUpdates {
    if (islands.length < 1) return updates

    const sortedIslands = islands.sort((i1, i2) =>
      i1.peers.length === i2.peers.length
        ? Math.sign(i1.sequenceId - i2.sequenceId)
        : Math.sign(i2.peers.length - i1.peers.length)
    )

    const biggestIslands: InternalIsland[] = [sortedIslands.shift()!]

    let anIsland: InternalIsland | undefined

    while ((anIsland = sortedIslands.shift())) {
      let merged = false

      const preferedIslandId = this.getPreferedIslandFor(anIsland)

      // We only support prefered islands for islands bigger and/or older than the one we are currently processing.
      // It would be very unlikely that there is a valid use case for the other possibilities
      const preferedIsland = preferedIslandId ? biggestIslands.find((it) => it.id === preferedIslandId) : undefined

      if (preferedIsland) {
        merged = this.mergeIntoIfPossible(updates, preferedIsland, anIsland)
      }

      for (let i = 0; !merged && i < biggestIslands.length; i++) {
        merged = this.mergeIntoIfPossible(updates, biggestIslands[i], anIsland)
      }

      if (!merged) {
        biggestIslands.push(anIsland)
      }
    }

    return updates
  }

  private getPreferedIslandFor(anIsland: Island) {
    const votes: Record<string, number> = {}
    let mostVoted: string | undefined

    for (const peer of anIsland.peers) {
      if (peer.preferedIslandId) {
        votes[peer.preferedIslandId] = peer.preferedIslandId in votes ? votes[peer.preferedIslandId] + 1 : 1

        if (!mostVoted || votes[mostVoted] < votes[peer.preferedIslandId]) {
          mostVoted = peer.preferedIslandId
        }
      }
    }

    return mostVoted
  }

  private intersectIslands(anIsland: InternalIsland, otherIsland: InternalIsland, intersectDistance: number) {
    return (
      this.intersectIslandGeometry(anIsland, otherIsland, intersectDistance) &&
      anIsland.peers.some((it) => this.intersectPeerGroup(it, otherIsland.peers, intersectDistance))
    )
  }

  private intersectIslandGeometry(anIsland: InternalIsland, otherIsland: InternalIsland, intersectDistance: number) {
    return (
      squaredDistance(anIsland.center, otherIsland.center) <=
      squared(anIsland.radius + otherIsland.radius + intersectDistance)
    )
  }

  private intersectPeerGroup(peer: PeerData, group: PeerData[], intersectDistance: number) {
    return group.some((it) => this.intersectPeers(peer, it, intersectDistance))
  }

  private intersectPeers(aPeer: PeerData, otherPeer: PeerData, intersectDistance: number) {
    return squaredDistance(aPeer.position, otherPeer.position) <= squared(intersectDistance)
  }

  private addPeersToIsland(island: InternalIsland, peers: PeerData[], updates: IslandUpdates): IslandUpdates {
    island.peers.push(...peers)
    this.markGeometryDirty(island)
    return this.setPeersIsland(island.id, peers, updates)
  }

  private markGeometryDirty(island: InternalIsland) {
    island._geometryDirty = true
  }

  private createIsland(group: PeerData[], updates: IslandUpdates, affectedIslands: Set<string>): IslandUpdates {
    const newIslandId = this.generateId()

    const connectionGenerators = this.connectionGenerators
    let transport: Transport | null = null

    const island: InternalIsland = {
      id: newIslandId,
      peers: group,
      maxPeers: this.options.maxPeersPerIsland,
      sequenceId: ++this.currentSequence,
      _geometryDirty: true,
      _recalculateGeometryIfNeeded() {
        if (this.peers.length > 0 && (this._geometryDirty || !this._radius || !this._center)) {
          const [center, radius] = islandGeometryCalculator(this.peers)
          this._center = center
          this._radius = radius
          this._geometryDirty = false
        }
      },
      get center() {
        this._recalculateGeometryIfNeeded()
        return this._center!
      },
      get radius() {
        this._recalculateGeometryIfNeeded()
        return this._radius!
      },
      get transport() {
        if (transport) {
          return transport
        }

        transport = 'p2p'

        const arbitraryLimit = 100 * parcelSize
        if (this.center[Z_AXIS] > arbitraryLimit) {
          const x = this.center[X_AXIS]
          if (x > arbitraryLimit && connectionGenerators.has('livekit')) {
            transport = 'livekit'
          } else if (x < arbitraryLimit && connectionGenerators.has('ws')) {
            transport = 'ws'
          }
        }

        return transport
      }
    }

    this.islands.set(newIslandId, island)
    affectedIslands.add(newIslandId)

    return this.setPeersIsland(newIslandId, group, updates)
  }

  private setPeersIsland(islandId: string, peers: PeerData[], updates: IslandUpdates): IslandUpdates {
    const island = this.getIsland(islandId)
    const generator = this.connectionGenerators.get(island ? island.transport : 'p2p')
    for (const peer of peers) {
      const previousIslandId = peer.islandId
      peer.islandId = islandId
      const connStr = generator!.generate(peer.id, islandId)
      updates[peer.id] = { action: 'changeTo', islandId, fromIslandId: previousIslandId, connStr }
    }

    return updates
  }

  getIslands(): InternalIsland[] {
    return [...this.islands.values()]
  }

  getIsland(id: string): InternalIsland | undefined {
    return this.islands.get(id)
  }

  getPeersCount(): number {
    return this.peers.size
  }

  getIslandsCount(): number {
    return this.islands.size
  }

  getPeerIds(): string[] {
    return [...this.peers.keys()]
  }

  calculateMetrics(): ArchipelagoMetrics {
    const islands = Array.from(this.islands.values())

    const islandsFilter = (transport: Transport) => (island: InternalIsland) =>
      island.transport === transport && island.peers.length

    const peersCount = (internalIslands: InternalIsland[]) =>
      internalIslands.reduce((total, island) => total + island.peers.length, 0)

    const livekitIslands = islands.filter(islandsFilter('livekit'))
    const wsIslands = islands.filter(islandsFilter('ws'))
    const p2pIslands = islands.filter(islandsFilter('p2p'))

    return {
      islands: {
        transport: { livekit: livekitIslands.length, ws: wsIslands.length, p2p: p2pIslands.length }
      },
      peers: {
        transport: { livekit: peersCount(livekitIslands), ws: peersCount(wsIslands), p2p: peersCount(p2pIslands) }
      }
    }
  }
}
