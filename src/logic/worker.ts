import { ILoggerComponent } from '@well-known-components/interfaces'
import { WorkerOptions } from '../controllers/ArchipelagoController'
import { IArchipelago, Archipelago } from '../logic/Archipelago'
import { NullLogger } from '../misc/utils'
import { IslandUpdates } from '../types'
import {
  DisposeResponse,
  IslandResponse,
  IslandsResponse,
  IslandsUpdated,
  WorkerMessage,
  WorkerStatusMessage
} from '../messageTypes'

const options: WorkerOptions = JSON.parse(process.argv[2])

console.log(`Starting worker with parameters ${JSON.stringify(process.argv)}`)

const archipelago: IArchipelago = new Archipelago(options.archipelagoParameters)

const logger: ILoggerComponent.ILogger = options.logging ? console : NullLogger

let status: 'idle' | 'working' = 'idle'

process.on('message', (message: WorkerMessage) => {
  switch (message.type) {
    case 'apply-updates':
      const { clearUpdates, positionUpdates } = message.updates
      performArchipelagoOperation(
        (archipelago) => ({
          ...archipelago.clearPeers(clearUpdates),
          ...archipelago.setPeersPositions(positionUpdates)
        }),
        'updates'
      )
      break
    case 'apply-options-update':
      performArchipelagoOperation((archipelago) => archipelago.modifyOptions(message.updates), 'options update')
      break
    case 'get-islands': {
      const response: IslandsResponse = {
        type: 'islands-response',
        payload: archipelago.getIslands(),
        requestId: message.requestId
      }
      process.send!(response)
      break
    }
    case 'get-island': {
      const response: IslandResponse = {
        type: 'island-response',
        payload: archipelago.getIsland(message.islandId),
        requestId: message.requestId
      }

      process.send!(response)
      break
    }
    case 'dispose-request': {
      const response: DisposeResponse = {
        type: 'dispose-response',
        requestId: message.requestId,
        payload: null
      }
      process.send!(response)
      break
    }
  }
})

function performArchipelagoOperation(operation: (archipelago: IArchipelago) => IslandUpdates, description: string) {
  setStatus('working')
  const startTime = Date.now()

  logger.debug(`Processing ${description}`)

  const updates = operation(archipelago)
  const updatesMessage: IslandsUpdated = {
    type: 'islands-updated',
    islandUpdates: updates
  }
  process.send!(updatesMessage)

  logger.debug(`Processing ${description} took: ${Date.now() - startTime}`)

  setStatus('idle')
}

function setStatus(aStatus: 'idle' | 'working') {
  logger.info(`Setting worker status to ${aStatus}`)
  status = aStatus
  const message: WorkerStatusMessage = { type: 'worker-status', status }
  process.send?.(message)
}

logger.info('Worker started')
setStatus('idle')
