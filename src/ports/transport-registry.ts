import { WebSocket } from 'ws'
import { Reader } from 'protobufjs/minimal'
import { IBaseComponent } from '@well-known-components/interfaces'
import { BaseComponents } from '../types'
import { TransportMessage } from '../controllers/proto/archipelago'

const PENDING_AUTH_TIMEOUT_MS = 400

export type Transport = {
  availableSeats: number
  usersCount: number
  maxIslandSize: number
  lastHeartbeat: number
  getConnectionString(userId: string, roomId: string): Promise<string>
}

type PendingAuthRequest = {
  started: number
  resolve: (connectionString: string) => void
  reject: (error: Error) => void
  timeout: undefined | NodeJS.Timeout
}

export type ITransportRegistryComponent = IBaseComponent & {
  onTransportConnection(ws: WebSocket): void
  getConnectionString(id: number, userId: string, roomId: string): Promise<undefined | string>
}

export async function createTransportRegistryComponent(
  components: Pick<BaseComponents, 'logs'>
): Promise<ITransportRegistryComponent> {
  const { logs } = components
  const logger = logs.getLogger('Transport Registry')

  let count = 0

  const availableTransports = new Map<number, Transport>()
  availableTransports.set(0, {
    availableSeats: -1,
    usersCount: -1,
    maxIslandSize: 50,
    lastHeartbeat: 0,
    getConnectionString(userId: string, roomId: string): Promise<string> {
      return Promise.resolve(`p2p:${roomId}.${userId}`)
    }
  })

  function onTransportConnection(ws: WebSocket) {
    count++
    const id = count
    logger.info(`New transport Connection: ${id}`)

    const pendingAuthRequests = new Map<string, PendingAuthRequest>()

    const transport: Transport = {
      availableSeats: 0,
      usersCount: 0,
      maxIslandSize: 0,
      lastHeartbeat: 0,
      getConnectionString(userId: string, roomId: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
          ws.send(
            TransportMessage.encode({
              message: {
                $case: 'authRequest',
                authRequest: {
                  userId,
                  roomId
                }
              }
            }).finish()
          )

          pendingAuthRequests.set(`${userId}-${roomId}`, {
            started: Date.now(),
            resolve,
            reject,
            timeout: setTimeout(() => {
              const pending = pendingAuthRequests.get(`${userId}-${roomId}`)
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
          logger.info(`New transport Connection: ${id}, ${type}`)
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
            authResponse: { userId, roomId, connectionString }
          } = transportMessage.message

          const key = `${userId}-${roomId}`
          const pending = pendingAuthRequests.get(key)
          if (pending) {
            pending.resolve(connectionString)
            if (pending.timeout) {
              clearTimeout(pending.timeout)
            }
            pendingAuthRequests.delete(key)
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

  async function getConnectionString(id: number, userId: string, roomId: string): Promise<undefined | string> {
    const transport = availableTransports.get(id)
    if (!transport) {
      return undefined
    }
    return transport.getConnectionString(userId, roomId)
  }
  return {
    onTransportConnection,
    getConnectionString
  }
}
