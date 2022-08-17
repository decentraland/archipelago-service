import { Lifecycle } from '@well-known-components/interfaces'
import { setupIslandsStatusReporting } from './controllers/islands-status-report'
import { setupListener } from './controllers/listener'
import { setupPublishing } from './controllers/publish'
import { setupRouter } from './controllers/routes'
import { setupServiceDiscovery } from './controllers/service-discovery'
import { ArchipelagoController } from './controllers/archipelago'
import { AppComponents, GlobalContext, TestComponents } from './types'

const DEFAULT_ARCHIPELAGO_ISLANDS_STATUS_UPDATE_INTERVAL = 1000 * 60 * 2 // 2 min
const DEFAULT_ARCHIPELAGO_STATUS_UPDATE_INTERVAL = 10000

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components, startComponents } = program
  const globalContext: GlobalContext = {
    components
  }

  // wire the HTTP router (make it automatic? TBD)
  const router = await setupRouter(globalContext)
  // register routes middleware
  components.server.use(router.middleware())
  // register not implemented/method not allowed/cors responses middleware
  components.server.use(router.allowedMethods())
  // set the context to be passed to the handlers
  components.server.setContext(globalContext)

  // start ports: db, listeners, synchronizations, etc
  await startComponents()

  const { nats, config, logs, transportRegistry } = components

  const flushFrequency = await config.requireNumber('ARCHIPELAGO_FLUSH_FREQUENCY')
  const joinDistance = await config.requireNumber('ARCHIPELAGO_JOIN_DISTANCE')
  const leaveDistance = await config.requireNumber('ARCHIPELAGO_LEAVE_DISTANCE')

  const logger = logs.getLogger('service')

  const archipelago = new ArchipelagoController({
    logs,
    flushFrequency,
    parameters: {
      joinDistance,
      leaveDistance
    }
  })

  setInterval(() => {
    const transports = transportRegistry.getTransports()
    archipelago.setTransports(transports)
  }, 1000)

  const islandsStatusUpdateFreq =
    (await config.getNumber('ARCHIPELAGO_ISLANDS_STATUS_UPDATE_INTERVAL')) ??
    DEFAULT_ARCHIPELAGO_ISLANDS_STATUS_UPDATE_INTERVAL
  const reporting = await setupIslandsStatusReporting(archipelago, { nats })
  setInterval(async () => {
    try {
      reporting.publishReport()
    } catch (err: any) {
      logger.error(err)
    }
  }, islandsStatusUpdateFreq)

  const serviceDiscoveryUpdateFreq =
    (await config.getNumber('ARCHIPELAGO_STATUS_UPDATE_INTERVAL')) ?? DEFAULT_ARCHIPELAGO_STATUS_UPDATE_INTERVAL
  const serviceDiscovery = await setupServiceDiscovery({ nats, config })

  setInterval(() => {
    try {
      serviceDiscovery.publishMessage()
    } catch (err: any) {
      logger.error(err)
    }
  }, serviceDiscoveryUpdateFreq)

  await setupListener(archipelago, { nats, config, logs })
  await setupPublishing(archipelago, { nats, transportRegistry, logs })
}
