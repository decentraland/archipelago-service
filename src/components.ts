import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { createLogComponent } from '@well-known-components/logger'
import { createFetchComponent } from './ports/fetch'
import { createMetricsComponent } from '@well-known-components/metrics'
import { AppComponents, GlobalContext } from './types'
import { metricDeclarations } from './metrics'
import { ArchipelagoWorkerController } from './controllers/worker-controller'
import { createNatsComponent } from '@well-known-components/nats-component'
import { createTransportRegistryComponent } from './ports/transport-registry'
import { WebSocketServer } from 'ws'

export async function createArchipelagoComponent(
  config: IConfigComponent,
  logs: ILoggerComponent
): Promise<ArchipelagoWorkerController> {
  const flushFrequency = await config.requireNumber('ARCHIPELAGO_FLUSH_FREQUENCY')
  const joinDistance = await config.requireNumber('ARCHIPELAGO_JOIN_DISTANCE')
  const leaveDistance = await config.requireNumber('ARCHIPELAGO_LEAVE_DISTANCE')
  const maxPeersPerIsland = await config.requireNumber('ARCHIPELAGO_MAX_PEERS_PER_ISLAND')
  const workerSrcPath = await config.getString('ARCHIPELAGO_WORKER_SRC_PATH')

  const controller = new ArchipelagoWorkerController({
    flushFrequency,
    archipelagoParameters: {
      joinDistance,
      leaveDistance,
      maxPeersPerIsland
    },
    workerSrcPath,
    components: { logs }
  })

  return controller
}

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })

  const logs = await createLogComponent({})

  const wss = new WebSocketServer({ noServer: true })
  const server = await createServerComponent<GlobalContext>({ config, logs, ws: wss }, {})
  const statusChecks = await createStatusCheckComponent({ server, config })
  const fetch = await createFetchComponent()
  const metrics = await createMetricsComponent(metricDeclarations, { server, config })
  const nats = await createNatsComponent({ config, logs })
  const archipelago = await createArchipelagoComponent(config, logs)
  const transportRegistry = await createTransportRegistryComponent({ logs })

  return {
    config,
    logs,
    server,
    statusChecks,
    fetch,
    metrics,
    nats,
    archipelago,
    transportRegistry
  }
}
