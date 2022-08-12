import { PeerPositionChange, Island, IslandUpdates, UpdatableArchipelagoParameters } from './types'

export type ApplyUpdates = {
  type: 'apply-updates'
  updates: { positionUpdates: PeerPositionChange[]; clearUpdates: string[] }
}

export type ApplyOptionsUpdate = {
  type: 'apply-options-update'
  updates: UpdatableArchipelagoParameters
}

type Request = { requestId: string }

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

export type DisposeRequest = {
  type: 'dispose-request'
} & Request

export type DisposeResponse = {
  type: 'dispose-response'
  requestId: string
} & Response

export type WorkerStatus = 'working' | 'idle' | 'unknown'

export type WorkerMessage =
  | ApplyUpdates
  | ApplyOptionsUpdate
  | WorkerResponse
  | WorkerRequest
  | IslandsUpdated
  | WorkerStatusMessage
  | WorkerRequestError

export type WorkerResponse = IslandsResponse | DisposeResponse

export type WorkerRequest = GetIslands | GetIsland | DisposeRequest
