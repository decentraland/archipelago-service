import { ArchipelagoParameters, Island, PeerPositionChange, UpdateSubscriber, Transport } from '../types'

import { fork, ChildProcess } from 'child_process'
import { GetIsland, WorkerRequest, WorkerResponse, WorkerStatus } from '../messageTypes'
import { IdGenerator, sequentialIdGenerator } from '../misc/idGenerator'
import { ILoggerComponent } from '@well-known-components/interfaces'

export type Options = {
  flushFrequency?: number
  archipelagoParameters: ArchipelagoParameters
  workerSrcPath?: string
  components: {
    logs?: ILoggerComponent
  }
}

type SetPositionUpdate = { type: 'set-position' } & PeerPositionChange
type ClearUpdate = { type: 'clear' }
type PeerUpdate = SetPositionUpdate | ClearUpdate
type PendingWorkerRequest = { resolve: (arg: any) => any; reject: (error: any) => any }

export type WorkerOptions = { archipelagoParameters: ArchipelagoParameters; logging: boolean }

export class WorkerController {
  worker: ChildProcess

  pendingPeerUpdates: Map<string, PeerUpdate> = new Map()
  transports: Transport[] = []

  updatesSubscribers: Set<UpdateSubscriber> = new Set()

  flushFrequency: number
  logger: ILoggerComponent.ILogger

  workerStatus: WorkerStatus = 'unknown'
  activeWorkerRequests: Record<string, PendingWorkerRequest> = {}
  requestIdGenerator: IdGenerator = sequentialIdGenerator('')

  disposed: boolean = false

  constructor(options: Options) {
    const { logs } = options.components
    this.logger = logs ? logs.getLogger('Archipelago') : console

    this.flushFrequency = options.flushFrequency ?? 2

    const workerSrcPath = options.workerSrcPath ?? __dirname + '/../logic/worker.js'

    this.worker = fork(workerSrcPath, [
      JSON.stringify({ archipelagoParameters: options.archipelagoParameters, logging: true })
    ])

    this.worker.on('message', this.handleWorkerMessage.bind(this))

    const loop = () => {
      if (!this.disposed) {
        const startTime = Date.now()
        this.flush()
        const flushElapsed = Date.now() - startTime
        setTimeout(loop, Math.max(this.flushFrequency * 1000 - flushElapsed), 1) // At least 1 ms between flushes
      }
    }

    loop()
  }

  flush() {
    if (this.pendingPeerUpdates.size > 0 && this.workerStatus === 'idle') {
      this.logger.info(
        `Flushing ${this.pendingPeerUpdates.size} peer updates and ${this.transports.length} transport updates`
      )
      const updatesToFlush = this.pendingPeerUpdates
      this.pendingPeerUpdates = new Map()

      const positionUpdates: PeerPositionChange[] = []
      const clearUpdates: string[] = []

      for (const [id, update] of updatesToFlush) {
        if (update.type === 'set-position') {
          const { type, ...rest } = update
          positionUpdates.push({ ...rest, id })
        } else {
          clearUpdates.push(id)
        }
      }

      this.sendMessageToWorker({
        type: 'apply-updates',
        updates: { positionUpdates, clearUpdates, transports: this.transports }
      })
    }
  }

  setTransports(transports: Transport[]): void {
    this.transports = transports
  }

  onPeerPositionsUpdate(...requests: PeerPositionChange[]): void {
    for (const req of requests) {
      this.pendingPeerUpdates.set(req.id, { type: 'set-position', ...req })
    }
  }

  getIslands(): Promise<Island[]> {
    return this.sendRequestToWorker({ type: 'get-islands' })
  }

  getIsland(id: string): Promise<Island | undefined> {
    const req: Omit<GetIsland, 'requestId'> = { type: 'get-island', islandId: id }

    return this.sendRequestToWorker(req)
  }

  onPeersRemoved(...ids: string[]): void {
    for (const id of ids) {
      this.pendingPeerUpdates.set(id, { type: 'clear' })
    }
  }

  subscribeToUpdates(subscriber: UpdateSubscriber): void {
    this.updatesSubscribers.add(subscriber)
  }

  unsubscribeFromUpdates(subscriber: UpdateSubscriber): void {
    this.updatesSubscribers.delete(subscriber)
  }

  handleWorkerMessage(message: WorkerResponse) {
    switch (message.type) {
      case 'islands-updated': {
        for (const subscriber of this.updatesSubscribers) {
          subscriber(message.islandUpdates)
        }
      }
    }

    if (message.type === 'worker-status') {
      this.workerStatus = message.status
    } else if (message.type === 'worker-request-error') {
      const { requestId, error } = message
      this.activeWorkerRequests[requestId]?.reject(error)
      delete this.activeWorkerRequests[requestId]
    } else if ('requestId' in message) {
      const { requestId, payload } = message
      this.activeWorkerRequests[requestId]?.resolve(payload)
      delete this.activeWorkerRequests[requestId]
    }
  }

  async dispose() {
    this.disposed = true
    await this.sendRequestToWorker({ type: 'dispose-request' })
    this.worker.kill()
  }

  sendMessageToWorker(message: WorkerRequest) {
    this.worker.send(message)
  }

  sendRequestToWorker<T>(message: Omit<WorkerRequest, 'requestId'>) {
    const requestId = this.requestIdGenerator.generateId()

    return new Promise<T>((resolve, reject) => {
      this.activeWorkerRequests[requestId] = { resolve, reject }

      this.sendMessageToWorker({ ...message, requestId } as WorkerRequest)

      setTimeout(() => {
        if (this.activeWorkerRequests[requestId]) {
          delete this.activeWorkerRequests[requestId]
          reject(new Error('Request timed out'))
        }
      }, 10 * 1000)
    })
  }
}
