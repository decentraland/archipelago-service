import { IBaseComponent } from '@well-known-components/interfaces'
import { BaseComponents } from '../types'

export type IArchipelagoMetricsComponent = IBaseComponent & {
  start: () => Promise<void>
  stop: () => Promise<void>
}

export async function createArchipelagoMetricsComponent(
  components: Pick<BaseComponents, 'logs' | 'config' | 'metrics' | 'archipelagoMetricsCollector'>
): Promise<IArchipelagoMetricsComponent> {
  const { archipelagoMetricsCollector, config, logs, metrics } = components

  const logger = logs.getLogger('Archipelago metrics component')
  const archipelagoMetricsInterval = await config.requireNumber('ARCHIPELAGO_METRICS_INTERVAL')

  let metricsInterval: NodeJS.Timer | undefined = undefined
  async function start() {
    metricsInterval = setInterval(async () => {
      try {
        const archMetrics = await archipelagoMetricsCollector.calculateMetrics()

        metrics.observe('dcl_archipelago_peers_count', { transport: 'livekit' }, archMetrics.peers.transport.livekit)
        metrics.observe('dcl_archipelago_peers_count', { transport: 'ws' }, archMetrics.peers.transport.ws)
        metrics.observe('dcl_archipelago_peers_count', { transport: 'p2p' }, archMetrics.peers.transport.p2p)

        metrics.observe(
          'dcl_archipelago_islands_count',
          { transport: 'livekit' },
          archMetrics.islands.transport.livekit
        )
        metrics.observe('dcl_archipelago_islands_count', { transport: 'ws' }, archMetrics.islands.transport.ws)
        metrics.observe('dcl_archipelago_islands_count', { transport: 'p2p' }, archMetrics.islands.transport.p2p)
      } catch (err: any) {
        logger.error(err)
      }
    }, archipelagoMetricsInterval)
  }

  async function stop() {
    if (metricsInterval) {
      clearInterval(metricsInterval)
    }
  }

  return {
    start,
    stop
  }
}
