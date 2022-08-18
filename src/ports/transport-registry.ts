import { WebSocket } from 'ws'
import { Reader } from 'protobufjs/minimal'
import { IBaseComponent } from '@well-known-components/interfaces'
import { BaseComponents, Transport } from '../types'
import { TransportMessage } from '../controllers/proto/archipelago'
import { v4 } from 'uuid'

const PENDING_AUTH_TIMEOUT_MS = 400

export type RegisteredTransport = {
  availableSeats: number
  usersCount: number
  maxIslandSize: number
  lastHeartbeat: number
  getConnectionStrings(userIds: string[], roomId: string): Promise<Record<string, string>>
}

type PendingAuthRequest = {
  started: number
  resolve: (connStrs: Record<string, string>) => void
  reject: (error: Error) => void
  timeout: undefined | NodeJS.Timeout
}

export type ITransportRegistryComponent = IBaseComponent & {
  onTransportConnection(ws: WebSocket): void
  getConnectionStrings(id: number, userIds: string[], roomId: string): Promise<undefined | Record<string, string>>
  getTransports(): Transport[]
}

export async function createTransportRegistryComponent(
  components: Pick<BaseComponents, 'logs'>
): Promise<ITransportRegistryComponent> {
  const { logs } = components
  const logger = logs.getLogger('Transport Registry')

  let count = 0

  const availableTransports = new Map<number, RegisteredTransport>()
  availableTransports.set(0, {
    availableSeats: -1,
    usersCount: -1,
    maxIslandSize: 50,
    lastHeartbeat: 0,
    getConnectionStrings(userIds: string[], roomId: string): Promise<Record<string, string>> {
      const connStrs: Record<string, string> = {}
      for (const userId of userIds) {
        connStrs[userId] = `p2p:${roomId}.${userId}`
      }
      return Promise.resolve(connStrs)
    }
  })

  function onTransportConnection(ws: WebSocket) {
    count++
    const id = count
    logger.info(`New transport Connection: ${id}`)

    const pendingAuthRequests = new Map<string, PendingAuthRequest>()

    const transport: RegisteredTransport = {
      availableSeats: 0,
      usersCount: 0,
      maxIslandSize: 0,
      lastHeartbeat: 0,
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
          availableTransports.set(id, transport)
          break
        }
        case 'heartbeat': {
          const {
            heartbeat: { availableSeats, usersCount }
          } = transportMessage.message

          transport.availableSeats = availableSeats
          transport.usersCount = usersCount
          transport.lastHeartbeat = Date.now()
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
      clearInterval(pingInterval)
    })
  }

  async function getConnectionStrings(
    id: number,
    userIds: string[],
    roomId: string
  ): Promise<undefined | Record<string, string>> {
    const transport = availableTransports.get(id)
    if (!transport) {
      return undefined
    }
    return transport.getConnectionStrings(userIds, roomId)
  }

  function getTransports(): Transport[] {
    const transports: Transport[] = []
    for (const [id, { availableSeats, usersCount, maxIslandSize }] of availableTransports) {
      transports.push({
        id,
        availableSeats,
        usersCount,
        maxIslandSize
      })
    }
    return transports
  }

  return {
    onTransportConnection,
    getConnectionStrings,
    getTransports
  }
}
