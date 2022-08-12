import { upgradeWebSocketResponse } from '@well-known-components/http-server/dist/ws'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { WebSocket } from 'ws'
import { GlobalContext } from '../../types'

export async function transportHandler(context: IHttpServerComponent.DefaultContext<GlobalContext>) {
  const {
    components: { logs, transportRegistry }
  } = context
  const logger = logs.getLogger('Transport Handler')

  logger.info('request to transportHandler')
  return upgradeWebSocketResponse((socket) => {
    logger.info('Websocket connected')
    transportRegistry.onTransportConnection(socket as any as WebSocket)
  })
}
