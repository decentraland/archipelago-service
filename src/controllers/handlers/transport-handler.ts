import { upgradeWebSocketResponse } from '@well-known-components/http-server/dist/ws'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { Reader } from 'protobufjs/minimal'
import { WebSocket } from 'ws'
import { GlobalContext, Transport } from '../../types'
import { v4 } from 'uuid'
import { TransportMessage } from '../proto/archipelago'

const PENDING_AUTH_TIMEOUT_MS = 400

type PendingAuthRequest = {
  started: number
  resolve: (connStrs: Record<string, string>) => void
  reject: (error: Error) => void
  timeout: undefined | NodeJS.Timeout
}

export async function transportHandler(context: IHttpServerComponent.DefaultContext<GlobalContext>) {
  const {
    components: { logs, transportRegistry }
  } = context
  const logger = logs.getLogger('Transport Handler')

  logger.info('request to transportHandler')
  let count = 0

  return upgradeWebSocketResponse((socket) => {
    const ws = socket as any as WebSocket
    count++
    const id = count
    logger.info(`New transport Connection: ${id}`)

    const pendingAuthRequests = new Map<string, PendingAuthRequest>()

    const transport: Transport = {
      id,
      availableSeats: 0,
      usersCount: 0,
      maxIslandSize: 0,
      getConnectionStrings(userIds: string[], roomId: string): Promise<Record<string, string>> {
        return new Promise<Record<string, string>>((resolve, reject) => {
          const requestId = v4()
          ws.send(
            TransportMessage.encode({
              message: {
                $case: 'authRequest',
                authRequest: {
                  requestId,
                  userIds,
                  roomId
                }
              }
            }).finish()
          )

          pendingAuthRequests.set(requestId, {
            started: Date.now(),
            resolve,
            reject,
            timeout: setTimeout(() => {
              const pending = pendingAuthRequests.get(requestId)
              if (pending) {
                pending.reject(new Error('request timeout'))
              }
            }, PENDING_AUTH_TIMEOUT_MS)
          })
        })
      }
    }
    ws.on('message', (message) => {
      const transportMessage = TransportMessage.decode(Reader.create(message as Buffer))

      switch (transportMessage.message?.$case) {
        case 'init': {
          const {
            init: { maxIslandSize, type }
          } = transportMessage.message
          transport.maxIslandSize = maxIslandSize
          logger.info(`New transport Connection: ${id}, type: ${type}`)
          break
        }
        case 'heartbeat': {
          const {
            heartbeat: { availableSeats, usersCount }
          } = transportMessage.message

          transport.availableSeats = availableSeats
          transport.usersCount = usersCount
          transportRegistry.onTransportConnected(transport)
          break
        }
        case 'authResponse': {
          const {
            authResponse: { requestId, connStrs }
          } = transportMessage.message

          const pending = pendingAuthRequests.get(requestId)
          if (pending) {
            pending.resolve(connStrs)
            if (pending.timeout) {
              clearTimeout(pending.timeout)
            }
            pendingAuthRequests.delete(requestId)
          }
          break
        }
      }
    })

    let isAlive = true
    ws.on('pong', () => {
      isAlive = true
    })

    const pingInterval = setInterval(function ping() {
      if (isAlive === false) {
        logger.warn(`Terminating ws because of ping timeout`)
        return ws.terminate()
      }

      isAlive = false
      ws.ping()
    }, 30000)

    ws.on('error', (error) => {
      logger.error(error)
    })

    ws.on('close', () => {
      logger.info('Websocket closed')
      transportRegistry.onTransportDisconnected(transport.id)
      clearInterval(pingInterval)
    })
  })
}
