import { ArchipelagoController } from '../../src/controllers/archipelago'

import expect from 'assert'
import { PeerPositionChange, IslandUpdates, ChangeToIslandUpdate } from '../../src/types'
import { sequentialIdGenerator } from '../../src/misc/idGenerator'
import { expectIslandsWith, expectIslandWith, setMultiplePeersAround } from '../helpers/archipelago'
import { createLogComponent } from '@well-known-components/logger'

type PositionWithId = [string, number, number, number]

describe('archipelago', () => {
  let archipelago: ArchipelagoController
  beforeEach(async () => {
    archipelago = new ArchipelagoController({
      logs: await createLogComponent({}),
      parameters: {
        joinDistance: 64,
        leaveDistance: 80
      }
    })

    archipelago.setTransports([
      {
        id: 0,
        availableSeats: -1,
        usersCount: -1,
        maxIslandSize: 200
      }
    ])
  })

  function setPositionArrays(...positions: PositionWithId[]) {
    archipelago.onPeerPositionsUpdate(positions.map(([id, ...position]) => ({ id, position })))
    return archipelago.flush()
  }

  it('joins two close peers in island', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 16, 0, 16])

    expect.strictEqual(archipelago.getIslands().length, 1)
    expectIslandWith(archipelago, '1', '2')
  })

  it('avoids joining a peer that is far away', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 16, 0, 16], ['3', 200, 0, 200])

    const islands = archipelago.getIslands()

    expect.strictEqual(islands.length, 2)
    expectIslandsWith(archipelago, ['1', '2'], ['3'])
  })

  it("joins two existing islands when a peer 'bridges' them", () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 16, 0, 16], ['3', 100, 0, 0])

    expect.strictEqual(archipelago.getIslands().length, 2)
    expectIslandsWith(archipelago, ['1', '2'], ['3'])

    setPositionArrays(['4', 50, 0, 0])

    expect.strictEqual(archipelago.getIslands().length, 1)

    expectIslandWith(archipelago, '1', '2', '3', '4')
  })

  it('splits islands when a peer leaves', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 16, 0, 16], ['3', 50, 0, 0])
    expectIslandWith(archipelago, '1', '2', '3')

    setPositionArrays(['3', 100, 0, 0])

    expectIslandsWith(archipelago, ['1', '2'], ['3'])
  })

  it('splits islands when a group of peers leaves', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 16, 0, 16], ['3', 50, 0, 0], ['4', 45, 0, 0])
    expectIslandWith(archipelago, '1', '2', '3', '4')

    setPositionArrays(['3', 100, 0, 0], ['4', 95, 0, 0])

    expectIslandsWith(archipelago, ['1', '2'], ['3', '4'])
  })

  it('respects join & leave radiuses for stability', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 16, 0, 16], ['3', 50, 0, 0], ['4', 45, 0, 0])
    expectIslandWith(archipelago, '1', '2', '3', '4')

    setPositionArrays(['5', -100, 0, 0], ['6', -105, 0, 0])

    expectIslandsWith(archipelago, ['1', '2', '3', '4'], ['5', '6'])

    setPositionArrays(['5', -50, 0, 0])

    expectIslandWith(archipelago, '1', '2', '3', '4', '5', '6')

    setPositionArrays(['5', -70, 0, 0])
    expectIslandWith(archipelago, '1', '2', '3', '4', '5', '6')

    setPositionArrays(['5', -85, 0, 0])

    expectIslandsWith(archipelago, ['1', '2', '3', '4'], ['5', '6'])
  })

  it('keeps biggest island id when splitting', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 16, 0, 16], ['3', 50, 0, 0], ['4', 45, 0, 0])
    const islandId = archipelago.getIslands()[0].id

    setPositionArrays(['3', 150, 0, 0])

    const island = archipelago.getIsland(islandId)

    expect.notStrictEqual(island!.peers.map((it) => it.id).sort(), ['1', '2', '4'])

    expectIslandWith(archipelago, '3')
  })

  it('can clear a peer', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 16, 0, 16], ['4', 50, 0, 0], ['3', 100, 0, 0])

    expectIslandsWith(archipelago, ['1', '2', '3', '4'])

    archipelago.onPeersRemoved(['4'])
    archipelago.flush()

    expectIslandsWith(archipelago, ['1', '2'], ['3'])
  })

  it('can add a peer again after it has been cleared', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 16, 0, 16])

    expectIslandsWith(archipelago, ['1', '2'])

    archipelago.onPeersRemoved(['1'])
    archipelago.onPeersRemoved(['2'])
    archipelago.flush()

    setPositionArrays(['1', 0, 0, 0])

    expectIslandsWith(archipelago, ['1'])
  })

  function expectChangedTo(updates: IslandUpdates, peerId: string, islandId: string, fromIslandId?: string) {
    expect.strictEqual(updates[peerId].islandId, islandId)
    expect.strictEqual(updates[peerId].action, 'changeTo')
    if (fromIslandId) {
      expect.strictEqual((updates[peerId] as ChangeToIslandUpdate).fromIslandId, fromIslandId)
    }
  }

  function expectLeft(updates: IslandUpdates, peerId: string, islandId: string) {
    expect.strictEqual(updates[peerId].islandId, islandId)
    expect.strictEqual(updates[peerId].action, 'leave')
  }

  function expectNoUpdate(updates: IslandUpdates, peerId: string) {
    expect.strictEqual(typeof updates[peerId], 'undefined')
  }

  it('provides updates when setting positions', () => {
    archipelago.onPeerPositionsUpdate([{ id: '0', position: [15, 0, 0] }])
    let updates = archipelago.flush()

    expectChangedTo(updates, '0', 'I1')
    archipelago.onPeerPositionsUpdate([{ id: '1', position: [0, 0, 0] }])
    updates = archipelago.flush()
    expectChangedTo(updates, '1', 'I1')
    expectNoUpdate(updates, '0')

    archipelago.onPeerPositionsUpdate([{ id: '2', position: [100, 0, 0] }])
    updates = archipelago.flush()

    expectChangedTo(updates, '2', 'I3')
    expectNoUpdate(updates, '1')
    expectNoUpdate(updates, '0')

    archipelago.onPeerPositionsUpdate([{ id: '3', position: [50, 0, 0] }])
    updates = archipelago.flush()

    expectChangedTo(updates, '2', 'I1', 'I3')
    expectChangedTo(updates, '3', 'I1')
    expectNoUpdate(updates, '1')
    expectNoUpdate(updates, '0')
  })

  it('provides updates when clearing peer', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 50, 0, 0], ['3', 100, 0, 0])

    expectIslandsWith(archipelago, ['1', '2', '3'])
    archipelago.onPeersRemoved(['2'])

    const updates = archipelago.flush()

    expectLeft(updates, '2', 'I1')
    expectChangedTo(updates, '3', 'I4', 'I1')
    expectNoUpdate(updates, '1')
  })

  it('calculates island geometry', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 40, 0, 40])

    const island = archipelago.getIslands()[0]

    expect.deepStrictEqual(island.center, [20, 0, 20])
    expect(Math.abs(island.radius - Math.sqrt(800)) < 0.0000001) // Distance between center and farthest peer
  })

  it('sets radius to encompass all peers', () => {
    setPositionArrays(['1', 0, 0, 0], ['2', 10, 0, 10], ['3', 6, 0, 6], ['4', 40, 0, 40])

    const island = archipelago.getIslands()[0]

    expect.deepStrictEqual(island.center, [14, 0, 14])
    expect(Math.abs(island.radius - Math.sqrt(1352)) < 0.0000001)
  })

  it('enforces max peers per island limit', () => {
    const idGenerator = sequentialIdGenerator('P')
    const firstRequests = setMultiplePeersAround(archipelago, [0, 0, 0], 190, idGenerator)

    expect.strictEqual(archipelago.getIslands().length, 1)
    expectIslandWith(archipelago, ...firstRequests.map((it) => it.id))

    const peerRequests = setMultiplePeersAround(archipelago, [100, 0, 0], 20, idGenerator)

    expect.strictEqual(archipelago.getIslands().length, 2)
    expectIslandWith(archipelago, ...peerRequests.map((it) => it.id))

    setPositionArrays(
      ...peerRequests.map((it) => [it.id, it.position[0] - 100, it.position[1], it.position[2]] as PositionWithId)
    )

    expect.strictEqual(archipelago.getIslands().length, 2)
    expectIslandWith(archipelago, ...firstRequests.map((it) => it.id))
    expectIslandWith(archipelago, ...peerRequests.map((it) => it.id))

    archipelago.onPeersRemoved(peerRequests.slice(0, 10).map((it) => it.id))
    archipelago.flush()

    expect.strictEqual(archipelago.getIslands().length, 1)
    expectIslandWith(archipelago, ...firstRequests.map((it) => it.id), ...peerRequests.slice(10, 20).map((it) => it.id))
  })

  it('merges with the biggest island available', () => {
    const idGenerator = sequentialIdGenerator('P')
    const superBigIsland = setMultiplePeersAround(archipelago, [0, 0, 0], 190, idGenerator)
    const bigIsland = setMultiplePeersAround(archipelago, [100, 0, 0], 150, idGenerator)
    const smallIsland = setMultiplePeersAround(archipelago, [200, 0, 0], 100, idGenerator)

    setPositionArrays(
      ...bigIsland.map((it) => [it.id, it.position[0] - 100, it.position[1], it.position[2]] as PositionWithId)
    )

    setPositionArrays(
      ...smallIsland.map((it) => [it.id, it.position[0] - 200, it.position[1], it.position[2]] as PositionWithId)
    )

    expect.strictEqual(archipelago.getIslands().length, 3)

    setPositionArrays(['newPeer', 0, 0, 0])
    expect.strictEqual(archipelago.getIslands().length, 3)

    expectIslandWith(archipelago, 'newPeer', ...superBigIsland.map((it) => it.id))

    const smallestIsland = setMultiplePeersAround(archipelago, [100, 0, 0], 20, idGenerator)

    setPositionArrays(
      ...smallestIsland.map((it) => [it.id, it.position[0] - 100, it.position[1], it.position[2]] as PositionWithId)
    )

    expectIslandWith(archipelago, ...smallestIsland.map((it) => it.id), ...bigIsland.map((it) => it.id))
  })

  function getIslandId(changes: PeerPositionChange[]) {
    const peerData = archipelago.getPeerData(changes[0].id)
    return archipelago.getIsland(peerData?.islandId!)?.id!
  }

  it('merges islands considering the preferedIsland for single peers', () => {
    function getIslandId(changes: PeerPositionChange[]) {
      const peerData = archipelago.getPeerData(changes[0].id)
      return archipelago.getIsland(peerData?.islandId!)?.id!
    }

    const idGenerator = sequentialIdGenerator('P')
    const superBigIsland = setMultiplePeersAround(archipelago, [0, 0, 0], 190, idGenerator)
    const bigIsland = setMultiplePeersAround(archipelago, [100, 0, 0], 150, idGenerator)
    const smallIsland = setMultiplePeersAround(archipelago, [200, 0, 0], 100, idGenerator)

    setPositionArrays(
      ...bigIsland.map((it) => [it.id, it.position[0] - 100, it.position[1], it.position[2]] as PositionWithId)
    )

    setPositionArrays(
      ...smallIsland.map((it) => [it.id, it.position[0] - 200, it.position[1], it.position[2]] as PositionWithId)
    )

    archipelago.onPeerPositionsUpdate([{ id: 'peer1', position: [0, 0, 0] }])
    let updates = archipelago.flush()

    expectChangedTo(updates, 'peer1', getIslandId(superBigIsland))

    archipelago.onPeerPositionsUpdate([{ id: 'peer2', position: [0, 0, 0], preferedIslandId: getIslandId(bigIsland) }])
    updates = archipelago.flush()

    expectChangedTo(updates, 'peer2', getIslandId(bigIsland))

    archipelago.onPeerPositionsUpdate([
      { id: 'peer3', position: [0, 0, 0], preferedIslandId: getIslandId(smallIsland) }
    ])
    updates = archipelago.flush()

    expectChangedTo(updates, 'peer3', getIslandId(smallIsland))
  })

  it('merges islands considering the preferedIsland for multiple peers even when set before', () => {
    const idGenerator = sequentialIdGenerator('P')
    setMultiplePeersAround(archipelago, [0, 0, 0], 190, idGenerator)
    const bigIsland = setMultiplePeersAround(archipelago, [100, 0, 0], 150, idGenerator)

    setPositionArrays(
      ...bigIsland.map((it) => [it.id, it.position[0] - 100, it.position[1], it.position[2]] as PositionWithId)
    )

    archipelago.onPeerPositionsUpdate([
      { id: 'peer1', position: [100, 0, 0], preferedIslandId: getIslandId(bigIsland) },
      { id: 'peer2', position: [100, 0, 0] }
    ])

    let updates = archipelago.flush()
    expectIslandWith(archipelago, 'peer1', 'peer2')

    expect.notStrictEqual(updates['peer1'].islandId, getIslandId(bigIsland))

    updates = setPositionArrays(['peer1', 0, 0, 0], ['peer2', 0, 0, 0])

    expect.strictEqual(updates['peer1'].islandId, getIslandId(bigIsland))
    expect.strictEqual(updates['peer2'].islandId, getIslandId(bigIsland))
  })
})
