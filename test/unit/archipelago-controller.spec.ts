import expect from 'assert'
import { IslandUpdates } from '../../src/interfaces'
import { ArchipelagoComponent } from '../../src/controllers/ArchipelagoController'
import { deepEqual, expectIslandsInControllerWith, untilTrue } from '../helpers/archipelago'

describe('archipelago controller', () => {
  let controller: ArchipelagoComponent
  let receivedUpdates: IslandUpdates[]

  beforeEach(() => {
    controller = new ArchipelagoComponent({
      archipelagoParameters: {
        joinDistance: 64,
        leaveDistance: 80,
        wsRoomService: { url: 'test_url', secret: '123456' }
      },
      flushFrequency: 0.05,
      workerSrcPath: './dist/logic/worker.js',
      components: {}
    })

    controller.subscribeToUpdates((updates) => receivedUpdates.push(updates))

    receivedUpdates = []
  })

  afterEach(async () => {
    await controller.dispose()
  })

  async function receivedUpdatesForPeers(...ids: string[]) {
    await untilTrue(
      () => ids.every((id) => receivedUpdates.some((update) => id in update)),
      `Peers ${ids.join(', ')} should have received updates and they didn't. Received updates: ${JSON.stringify(
        receivedUpdates
      )}`
    )
  }

  function clearUpdates() {
    receivedUpdates = []
  }

  function getLatestUpdateFor(peerId: string) {
    for (let i = receivedUpdates.length - 1; i >= 0; i--) {
      const update = receivedUpdates[i][peerId]
      if (update) {
        return update
      }
    }

    return undefined
  }

  it('should forward positions and receive updates', async () => {
    controller.setPeersPositions(
      { id: '1', position: [0, 0, 0] },
      { id: '2', position: [4, 0, 4] },
      { id: '3', position: [90, 0, 90] }
    )

    controller.flush()

    await receivedUpdatesForPeers('1', '2', '3')

    expect.strictEqual(await controller.getIslandsCount(), 2)
    expect.strictEqual(await controller.getPeersCount(), 3)

    const update1 = getLatestUpdateFor('1')
    const update2 = getLatestUpdateFor('2')
    const update3 = getLatestUpdateFor('3')

    expect.strictEqual(update1!.islandId, update2!.islandId)
    expect.notStrictEqual(update1!.islandId, update3!.islandId)

    await expectIslandsInControllerWith(controller, ['1', '2'], ['3'])
  })

  it('should forward option updates and receive updates', async () => {
    controller.setPeersPositions({ id: '1', position: [0, 0, 0] }, { id: '2', position: [16, 0, 16] })

    controller.flush()
    await receivedUpdatesForPeers('1', '2')
    expect.strictEqual(await controller.getIslandsCount(), 1)
    expect.strictEqual(await controller.getPeersCount(), 2)
    clearUpdates()

    controller.modifyOptions({ joinDistance: 4, leaveDistance: 5 })

    await receivedUpdatesForPeers('2')

    expect.strictEqual(await controller.getIslandsCount(), 2)
    expect.strictEqual(await controller.getPeersCount(), 2)

    await expectIslandsInControllerWith(controller, ['1'], ['2'])
  })

  it('should allow to clear peers', async () => {
    controller.setPeersPositions({ id: '1', position: [0, 0, 0] }, { id: '2', position: [4, 0, 4] })

    controller.flush()

    await receivedUpdatesForPeers('1', '2')

    await expectIslandsInControllerWith(controller, ['1', '2'])

    receivedUpdates = []

    controller.clearPeers('1')

    controller.flush()

    await receivedUpdatesForPeers('1')
    const update = getLatestUpdateFor('1')

    expect.strictEqual(update!.action, 'leave')
  })

  it('should eventually flush automatically', async () => {
    controller.setPeersPositions(
      { id: '1', position: [0, 0, 0] },
      { id: '2', position: [4, 0, 4] },
      { id: '3', position: [90, 0, 90] }
    )

    await receivedUpdatesForPeers('1', '2', '3')

    await expectIslandsInControllerWith(controller, ['1', '2'], ['3'])
  })

  it('should allow to query specific islands', async () => {
    controller.setPeersPositions(
      { id: '1', position: [0, 0, 0] },
      { id: '2', position: [4, 0, 4] },
      { id: '3', position: [90, 0, 90] }
    )

    await receivedUpdatesForPeers('1', '2', '3')

    const update = getLatestUpdateFor('1')

    const island = await controller.getIsland(update!.islandId)

    const isDeepEqual = deepEqual(island!.peers.map((it) => it.id).sort(), ['1', '2'])
    expect.strictEqual(isDeepEqual, true)
  })

  it('should allow to query specific peers', async () => {
    controller.setPeersPositions(
      { id: '1', position: [0, 0, 0] },
      { id: '2', position: [4, 0, 4] },
      { id: '99', position: [984, 0, 984] }
    )

    await receivedUpdatesForPeers('1', '2', '99')

    const update = getLatestUpdateFor('99')

    const peerData = await controller.getPeerData('99')

    expect.strictEqual(peerData!.islandId, update!.islandId)

    const peersData = await controller.getPeersData(['1', '2'])

    expect.strictEqual(peersData['1'].islandId, peersData['2'].islandId)
    expect.strictEqual(peersData['1'].islandId, getLatestUpdateFor('1')!.islandId)
    expect.strictEqual(peersData['2'].islandId, getLatestUpdateFor('2')!.islandId)
  })

  it('should allow to set preferred island through controller', async () => {
    controller.setPeersPositions({ id: '1', position: [0, 0, 0], preferedIslandId: 'I99' })

    await receivedUpdatesForPeers('1')

    const peerData = await controller.getPeerData('1')

    expect.strictEqual(peerData?.preferedIslandId, 'I99')
  })

  it('should allow to get island information through controller', async () => {
    controller.setPeersPositions({ id: '1', position: [0, 0, 0] })

    controller.flush()

    await receivedUpdatesForPeers('1')

    const islandId = (await controller.getPeerData('1'))?.islandId!

    const island = await controller.getIsland(islandId)

    expect.strictEqual(island?.id, islandId)
    expect.strictEqual(island.peers.length, 1)
    expect.strictEqual(island.peers[0].id, '1')
  })

  it('should allow to get peer ids', async () => {
    controller.setPeersPositions({ id: '1', position: [0, 0, 0] }, { id: '2', position: [0, 0, 0] })

    controller.flush()

    await receivedUpdatesForPeers('1', '2')

    const peerIds = await controller.getPeerIds()

    expect.strictEqual(deepEqual(peerIds.sort(), ['1', '2']), true)
  })
})
