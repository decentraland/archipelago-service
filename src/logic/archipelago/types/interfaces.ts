import { ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { metricDeclarations } from '../../../metrics'
import { IdGenerator } from '../misc/idGenerator'

export type Position3D = [number, number, number]

export type PeerData = {
  id: string
  position: Position3D
  preferedIslandId?: string
  islandId?: string
}

export type Island = {
  id: string
  peers: PeerData[]
  maxPeers: number
  center: Position3D
  radius: number
  sequenceId: number
}

export type PeerPositionChange = { id: string; position: Position3D; preferedIslandId?: string }

export type UpdateSubscriber = (updates: IslandUpdates) => any

export interface ArchipelagoController {
  setPeersPositions(...requests: PeerPositionChange[]): void
  getIslands(): Promise<Island[]>
  getIsland(id: string): Promise<Island | undefined>
  clearPeers(...ids: string[]): void
  getPeersCount(): Promise<number>
  getPeerIds(): Promise<string[]>
  getIslandsCount(): Promise<number>
  subscribeToUpdates(subscriber: UpdateSubscriber): void
  unsubscribeFromUpdates(subscriber: UpdateSubscriber): void
  getPeerData(id: string): Promise<PeerData | undefined>
  getPeersData(ids: string[]): Promise<Record<string, PeerData>>
  dispose(): Promise<void>
  flush(): void
  modifyOptions(options: UpdatableArchipelagoParameters): void
}

export type ChangeToIslandUpdate = {
  action: 'changeTo'
  islandId: string
  connStr: string
  fromIslandId?: string
}

export type LeaveIslandUpdate = {
  action: 'leave'
  islandId: string
}

export type IslandUpdate = ChangeToIslandUpdate | LeaveIslandUpdate

export type IslandUpdates = Record<string, IslandUpdate>

export type ArchipelagoOptions = {
  maxPeersPerIsland: number
  joinDistance: number
  leaveDistance: number
  islandIdGenerator: IdGenerator
  livekit?: {
    url: string
    apiKey: string
    apiSecret: string
  }
  wsRoomService?: {
    url: string
    secret: string
  }
}

export type MandatoryArchipelagoOptions = Pick<ArchipelagoOptions, 'joinDistance' | 'leaveDistance'>

export type ArchipelagoParameters = MandatoryArchipelagoOptions & Partial<ArchipelagoOptions>

export type UpdatableArchipelagoParameters = Partial<Omit<ArchipelagoOptions, 'islandIdGenerator'>>

type ArchipelagoControllerComponents = {
  metrics?: IMetricsComponent<keyof typeof metricDeclarations>
  logs?: ILoggerComponent
}

export type ArchipelagoControllerOptions = {
  flushFrequency?: number
  archipelagoParameters: ArchipelagoParameters
  workerSrcPath?: string
  components: ArchipelagoControllerComponents
}

export { IdGenerator } from '../misc/idGenerator'
