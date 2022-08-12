import { PeerPositionChange, Island, IslandUpdates, UpdatableArchipelagoParameters } from './types'

// requests
type Request = { requestId: string }

export type ApplyUpdates = {
  type: 'apply-updates'
  updates: { positionUpdates: PeerPositionChange[]; clearUpdates: string[] }
}

export type ApplyOptionsUpdate = {
  type: 'apply-options-update'
  updates: UpdatableArchipelagoParameters
}

export type GetIslands = {
  type: 'get-islands'
} & Request

export type GetIsland = {
  type: 'get-island'
  islandId: string
} & Request

export type IslandsUpdated = {
  type: 'islands-updated'
  islandUpdates: IslandUpdates
}

export type DisposeRequest = {
  type: 'dispose-request'
} & Request

export type WorkerRequest = GetIslands | GetIsland | DisposeRequest | ApplyUpdates | ApplyOptionsUpdate

// Responses
type Response = {
  requestId: string
  payload: any
}

export type IslandsResponse = {
  type: 'islands-response'
  payload: Island[]
} & Response

export type IslandResponse = {
  type: 'island-response'
  payload: Island | undefined
} & Response

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
  type: 'dispose-response'
  requestId: string
} & Response

export type WorkerStatus = 'working' | 'idle' | 'unknown'

export type WorkerResponse =
  | IslandsResponse
  | DisposeResponse
  | IslandsUpdated
  | WorkerRequestError
  | WorkerStatusMessage
