import { PeerData, Position3D, Island, IslandUpdates, PeerPositionChange, UpdateSubscriber, Transport } from '../types'

import { findMax, popMax } from '../misc/utils'
import { IdGenerator, sequentialIdGenerator } from '../misc/idGenerator'
import { ILoggerComponent } from '@well-known-components/interfaces'

export type Options = {
  logs: ILoggerComponent
  flushFrequency?: number
  parameters: {
    joinDistance: number
    leaveDistance: number
  }
}

const X_AXIS = 0
const Z_AXIS = 2

const squaredDistance = (p1: Position3D, p2: Position3D) => {
  // By default, we use XZ plane squared distance. We ignore "height"
  const xDiff = p2[X_AXIS] - p1[X_AXIS]
  const zDiff = p2[Z_AXIS] - p1[Z_AXIS]

  return xDiff * xDiff + zDiff * zDiff
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

export class ArchipelagoController {
  private transports: Transport[] = []
  private peers: Map<string, PeerData> = new Map()
  private islands: Map<string, Island> = new Map()
  private currentSequence: number = 0
  private joinDistance: number
  private leaveDistance: number
  private islandIdGenerator = sequentialIdGenerator('I')

  private pendingNewPeers = new Map<string, PeerData>()
  private pendingUpdates: IslandUpdates = {}

  updatesSubscribers: Set<UpdateSubscriber> = new Set()

  flushFrequency: number
  logger: ILoggerComponent.ILogger

  requestIdGenerator: IdGenerator = sequentialIdGenerator('')

  disposed: boolean = false

  constructor({ logs, flushFrequency, parameters: { joinDistance, leaveDistance } }: Options) {
    this.logger = logs.getLogger('Archipelago')

    this.flushFrequency = flushFrequency ?? 2
    this.joinDistance = joinDistance
    this.leaveDistance = leaveDistance

    const loop = () => {
      if (!this.disposed) {
        const startTime = Date.now()
        this.flush()
        const flushElapsed = Date.now() - startTime
        setTimeout(loop, Math.max(this.flushFrequency * 1000 - flushElapsed), 1) // At least 1 ms between flushes
      }
    }

    loop()
  }

  setTransports(transports: Transport[]): void {
    this.transports = transports

    const transportIds = new Set<number>()
    for (const transport of transports) {
      transportIds.add(transport.id)
    }

    // NOTE(hugo): we don't recreate islands, this will happen naturally if
    // the transport is actually down, but we don't want to assign new peers
    // there
    for (const island of this.islands.values()) {
      // TODO: test this
      if (!transportIds.has(island.transportId)) {
        island.maxPeers = 0
      }
    }
  }

  onPeerPositionsUpdate(changes: PeerPositionChange[]): void {
    for (const change of changes) {
      const { id, position, preferedIslandId } = change
      if (!this.peers.has(id)) {
        this.pendingNewPeers.set(id, change)
      } else {
        const peer = this.peers.get(id)!
        peer.position = position

        // We can set the prefered island to undefined by explicitly providing the key but no value.
        // If we don't provide the key, we leave it as it is
        if ('preferedIslandId' in change) {
          peer.preferedIslandId = preferedIslandId
        }

        if (peer.islandId) {
          const island = this.islands.get(peer.islandId)!
          island._geometryDirty = true
        }
      }
    }
  }

  getIslands(): Island[] {
    return Array.from(this.islands.values())
  }

  getIsland(id: string): Island | undefined {
    return this.islands.get(id)
  }

  getPeerData(id: string): PeerData | undefined {
    return this.peers.get(id)
  }

  subscribeToUpdates(subscriber: UpdateSubscriber): void {
    this.updatesSubscribers.add(subscriber)
  }

  unsubscribeFromUpdates(subscriber: UpdateSubscriber): void {
    this.updatesSubscribers.delete(subscriber)
  }

  onPeersRemoved(ids: string[]): void {
    for (const id of ids) {
      const peer = this.peers.get(id)

      if (peer) {
        this.peers.delete(id)
        if (peer.islandId) {
          const island = this.islands.get(peer.islandId)!

          const idx = island.peers.findIndex((it) => it.id === id)
          if (idx >= 0) {
            island.peers.splice(idx, 1)
          }

          if (island.peers.length === 0) {
            this.islands.delete(island.id)
          }

          island._geometryDirty = true

          this.pendingUpdates[peer.id] = { action: 'leave', islandId: peer.islandId }
        }
      }
    }
  }

  flush(): IslandUpdates {
    for (const [id, change] of this.pendingNewPeers) {
      this.peers.set(id, change)
      this.createIsland([change])
    }
    this.pendingNewPeers.clear()

    const affectedIslands = new Set<string>()
    for (const island of this.islands.values()) {
      if (island._geometryDirty) {
        affectedIslands.add(island.id)
      }
    }

    for (const islandId of affectedIslands) {
      this.checkSplitIsland(this.islands.get(islandId)!, affectedIslands)
    }

    // NOTE: check if islands can be merged
    const processedIslands: Record<string, boolean> = {}

    for (const islandId of affectedIslands) {
      if (!processedIslands[islandId] && this.islands.has(islandId)) {
        const island = this.islands.get(islandId)!
        const islandsIntersected: Island[] = []
        for (const [, otherIsland] of this.islands) {
          if (islandId !== otherIsland.id && this.intersectIslands(island, otherIsland, this.joinDistance)) {
            islandsIntersected.push(otherIsland)
            processedIslands[islandId] = true
          }
        }
        if (islandsIntersected.length > 0) {
          this.mergeIslands(island, ...islandsIntersected)
        }
      }
    }

    const updates = Object.assign({}, this.pendingUpdates)
    this.pendingUpdates = {}

    for (const subscriber of this.updatesSubscribers) {
      subscriber(updates)
    }
    return updates
  }

  private checkSplitIsland(island: Island, affectedIslands: Set<string>) {
    const peerGroups: PeerData[][] = []

    for (const peer of island.peers) {
      const groupsIntersected = peerGroups.filter((it) => this.intersectPeerGroup(peer, it, this.leaveDistance))
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
      island._geometryDirty = true

      for (const group of peerGroups) {
        affectedIslands.add(this.createIsland(group))
      }
    }
  }

  private createIsland(group: PeerData[]) {
    const newIslandId = this.islandIdGenerator.generateId()

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

    // TODO
    // try {
    // getConnectionStrings (group)
    // } catch() {
    //     connectionStrings = p2p.getConnectionStrings()
    //     transportId = p2p
    // }

    const island: Island = {
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

    this.setPeersIsland(island, group)

    return newIslandId
  }

  private mergeIntoIfPossible(islandToMergeInto: Island, anIsland: Island) {
    function canMerge(islandToMergeInto: Island, anIsland: Island) {
      return islandToMergeInto.peers.length + anIsland.peers.length <= islandToMergeInto.maxPeers
    }

    if (canMerge(islandToMergeInto, anIsland)) {
      islandToMergeInto.peers.push(...anIsland.peers)
      this.setPeersIsland(islandToMergeInto, anIsland.peers)
      this.islands.delete(anIsland.id)
      islandToMergeInto._geometryDirty = true

      return true
    } else {
      return false
    }
  }

  private mergeIslands(...islands: Island[]) {
    const sortedIslands = islands.sort((i1, i2) =>
      i1.peers.length === i2.peers.length
        ? Math.sign(i1.sequenceId - i2.sequenceId)
        : Math.sign(i2.peers.length - i1.peers.length)
    )

    const biggestIslands: Island[] = [sortedIslands.shift()!]

    let anIsland: Island | undefined

    while ((anIsland = sortedIslands.shift())) {
      let merged = false

      const preferedIslandId = this.getPreferedIslandFor(anIsland)

      // We only support prefered islands for islands bigger and/or older than the one we are currently processing.
      // It would be very unlikely that there is a valid use case for the other possibilities
      const preferedIsland = preferedIslandId ? biggestIslands.find((it) => it.id === preferedIslandId) : undefined

      if (preferedIsland) {
        merged = this.mergeIntoIfPossible(preferedIsland, anIsland)
      }

      for (let i = 0; !merged && i < biggestIslands.length; i++) {
        merged = this.mergeIntoIfPossible(biggestIslands[i], anIsland)
      }

      if (!merged) {
        biggestIslands.push(anIsland)
      }
    }
  }

  private setPeersIsland(island: Island, peers: PeerData[]) {
    for (const peer of peers) {
      const previousIslandId = peer.islandId
      peer.islandId = island.id
      this.pendingUpdates[peer.id] = {
        action: 'changeTo',
        islandId: island.id,
        fromIslandId: previousIslandId,
        transportId: island.transportId
      }
    }
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

  private intersectIslands(anIsland: Island, otherIsland: Island, intersectDistance: number) {
    const intersectIslandGeometry =
      squaredDistance(anIsland.center, otherIsland.center) <=
      squared(anIsland.radius + otherIsland.radius + intersectDistance)

    return (
      intersectIslandGeometry &&
      anIsland.peers.some((it) => this.intersectPeerGroup(it, otherIsland.peers, intersectDistance))
    )
  }

  private intersectPeerGroup(peer: PeerData, group: PeerData[], intersectDistance: number) {
    const intersectPeers = (aPeer: PeerData, otherPeer: PeerData) => {
      return squaredDistance(aPeer.position, otherPeer.position) <= squared(intersectDistance)
    }
    return group.some((it) => intersectPeers(peer, it))
  }

  async dispose() {
    this.disposed = true
  }
}
