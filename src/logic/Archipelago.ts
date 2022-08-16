import { sequentialIdGenerator } from '../misc/idGenerator'
import {
  Position3D,
  PeerData,
  ArchipelagoOptions,
  IslandUpdates,
  PeerPositionChange,
  Island,
  ArchipelagoParameters,
  Transport
} from '../types'
import { findMax, popMax } from '../misc/utils'

export interface IArchipelago {
  getIslandsCount(): number
  getPeerData(id: string): PeerData | undefined

  getIsland(id: string): Island | undefined
  getIslands(): Island[]

  onPeersRemoved(ids: string[]): IslandUpdates
  onPeersPositionsUpdate(requests: PeerPositionChange[]): IslandUpdates
  onTransportsUpdate(transports: Transport[]): IslandUpdates
}

const X_AXIS = 0
const Z_AXIS = 2

const squaredDistance = (p1: Position3D, p2: Position3D) => {
  // By default, we use XZ plane squared distance. We ignore "height"
  const xDiff = p2[X_AXIS] - p1[X_AXIS]
  const zDiff = p2[Z_AXIS] - p1[Z_AXIS]

  return xDiff * xDiff + zDiff * zDiff
}

export function defaultOptions() {
  return {
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
  transportId: number
  _center?: Position3D
  _radius?: number
  _geometryDirty: boolean
  _recalculateGeometryIfNeeded: () => void
}

export class Archipelago implements IArchipelago {
  private transports: Transport[] = []
  private peers: Map<string, PeerData> = new Map()
  private islands: Map<string, InternalIsland> = new Map()

  private options: ArchipelagoOptions

  private currentSequence: number = 0

  constructor(options: ArchipelagoParameters) {
    this.options = { ...defaultOptions(), ...options }
  }

  /**
   * This returns a map containing the peers that left or changed island as keys, how they changed as values
   * */
  onPeersPositionsUpdate(changes: PeerPositionChange[]): IslandUpdates {
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

  onTransportsUpdate(transports: Transport[]): IslandUpdates {
    this.transports = transports

    const transportIds = new Set<number>()
    for (const transport of transports) {
      transportIds.add(transport.id)
    }

    // NOTE(hugo): we don't recreate islands, this will happen naturally if
    // the transport is actually down, but we don't want to assign new peers
    // there
    for (const island of this.islands.values()) {
      if (!transportIds.has(island.transportId)) {
        island.maxPeers = 0
      }
    }

    return {}
  }

  onPeersRemoved(ids: string[]): IslandUpdates {
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
      islandToMergeInto.peers.push(...anIsland.peers)
      updates = this.setPeersIsland(islandToMergeInto, anIsland.peers, updates)
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

  private markGeometryDirty(island: InternalIsland) {
    island._geometryDirty = true
  }

  private createIsland(group: PeerData[], updates: IslandUpdates, affectedIslands: Set<string>): IslandUpdates {
    const newIslandId = this.options.islandIdGenerator.generateId()

    const reservedSeatsPerTransport = new Map<number, number>()
    for (const island of this.islands.values()) {
      if (island.transportId === 0) {
        continue
      }

      const reserved = reservedSeatsPerTransport.get(island.transportId) || 0
      reservedSeatsPerTransport.set(island.transportId, reserved + (island.maxPeers - island.peers.length))
    }

    let transportId = 0 // p2p
    let maxPeers = 0

    for (const transport of this.transports) {
      if (transport.id === 0) {
        if (transportId === 0) {
          maxPeers = transport.maxIslandSize
        }
        continue
      }

      const reservedSeats = reservedSeatsPerTransport.get(transport.id) || 0
      if (transport.availableSeats - reservedSeats >= transport.maxIslandSize) {
        transportId = transport.id
        maxPeers = transport.maxIslandSize
      }
    }

    const island: InternalIsland = {
      id: newIslandId,
      transportId,
      peers: group,
      maxPeers,
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
      }
    }

    this.islands.set(newIslandId, island)
    affectedIslands.add(newIslandId)

    return this.setPeersIsland(island, group, updates)
  }

  private setPeersIsland(island: InternalIsland, peers: PeerData[], updates: IslandUpdates): IslandUpdates {
    for (const peer of peers) {
      const previousIslandId = peer.islandId
      peer.islandId = island.id
      updates[peer.id] = {
        action: 'changeTo',
        islandId: island.id,
        fromIslandId: previousIslandId,
        transportId: island.transportId
      }
    }

    return updates
  }

  getPeerData(id: string): PeerData | undefined {
    return this.peers.get(id)
  }

  getIslandsCount(): number {
    return this.islands.size
  }

  getIslands(): InternalIsland[] {
    return [...this.islands.values()]
  }

  getIsland(id: string): InternalIsland | undefined {
    return this.islands.get(id)
  }
}
