import { createConfigComponent } from '@well-known-components/env-config-provider'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { createLogComponent } from '@well-known-components/logger'
import { createLocalNatsComponent } from '@well-known-components/nats-component'
import { INatsComponent } from '@well-known-components/nats-component/dist/types'
import { IslandStatusMessage } from '../../src/controllers/proto/archipelago'
import { createReportOverNatsComponent, IReportOverNatsComponent } from '../../src/ports/report-over-nats'
import { UpdateSubscriber, Island } from '../../src/types'
import { Reader } from 'protobufjs/minimal'

describe('report over nats', () => {
  let logs: ILoggerComponent
  let nats: INatsComponent
  let reporter: IReportOverNatsComponent | undefined = undefined

  const config = createConfigComponent({
    ARCHIPELAGO_STATUS_UPDATE_INTERVAL: '0',
    ARCHIPELAGO_ISLANDS_STATUS_UPDATE_INTERVAL: '0'
  })

  beforeAll(async () => {
    logs = await createLogComponent({})
    nats = await createLocalNatsComponent()
  })

  afterEach(async () => {
    if (reporter) {
      await reporter.stop()
    }
  })

  it('should listen connections and clear peers', async () => {
    const islands: Island[] = [
      {
        id: 'I1',
        center: [0, 0, 0],
        radius: 100,
        maxPeers: 100,
        peers: [],
        sequenceId: 10,
        transport: 'p2p'
      }
    ]
    const archipelagoStatus = {
      subscribeToUpdates(subscriber: UpdateSubscriber): void {},
      getIslands(): Promise<Island[]> {
        return Promise.resolve(islands)
      },
      getIsland(id: string): Promise<Island | undefined> {
        return undefined
      }
    }

    reporter = await createReportOverNatsComponent({ logs, nats, config, archipelagoStatus })

    reporter.startIslandsReportInterval()

    for await (const message of nats.subscribe('archipelago.islands').generator) {
      const { data } = IslandStatusMessage.decode(Reader.create(message.data))
      expect(data).toHaveLength(1)
      expect(data).toEqual(
        expect.arrayContaining([
          {
            id: 'I1',
            peers: [],
            maxPeers: 100,
            center: {
              x: 0,
              y: 0,
              z: 0
            },
            radius: 100
          }
        ])
      )
      break
    }
  })
})
