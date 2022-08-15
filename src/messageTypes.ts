import { PeerPositionChange, Island, IslandUpdates, Transport } from './types'

// requests
export type ApplyUpdates = {
  type: 'apply-updates'
  updates: { positionUpdates: PeerPositionChange[]; clearUpdates: string[]; transports: Transport[] }
}

export type GetIslands = {
  requestId: string
  type: 'get-islands'
}

export type GetIsland = {
  requestId: string
  type: 'get-island'
  islandId: string
}

export type IslandsUpdated = {
  type: 'islands-updated'
  islandUpdates: IslandUpdates
}

export type DisposeRequest = {
  requestId: string
  type: 'dispose-request'
}

export type WorkerRequest = GetIslands | GetIsland | DisposeRequest | ApplyUpdates

// Responses
export type IslandsResponse = {
  requestId: string
  type: 'islands-response'
  payload: Island[]
}

export type IslandResponse = {
  requestId: string
  type: 'island-response'
  payload: Island | undefined
}

export type WorkerStatusMessage = {
  type: 'worker-status'
  status: 'working' | 'idle'
}

export type WorkerRequestError = {
  type: 'worker-request-error'
  requestId: string
  error: any
}

export type DisposeResponse = {
  requestId: string
  type: 'dispose-response'
  payload: any
}

export type WorkerStatus = 'working' | 'idle' | 'unknown'

export type WorkerResponse =
  | IslandsResponse
  | DisposeResponse
  | IslandsUpdated
  | WorkerRequestError
  | WorkerStatusMessage
