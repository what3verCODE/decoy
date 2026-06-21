import { sample } from 'effector'
import { createGate } from 'effector-react'
import { createCollectionModel } from './create-collection-model'
import { createCollectionsModel } from './create-collections-model'
import { createLayoutModel } from './create-layout-model'
import { createLogsModel } from './create-logs-model'
import { createPlaygroundModel } from './create-playground-model'
import { createRouteModel } from './create-route-model'
import { createRoutesModel } from './create-routes-model'
import { createSelectionModel } from './create-selection-model'
import { createServicesModel } from './create-services-model'
import { createSessionsModel } from './create-sessions-model'

export const PageGate = createGate()

export const logsModel = createLogsModel()

// The dashboard layout is local-first (#91) and unscoped to any service: one model owns
// the persisted `{ version, layouts, hidden }` object that drives the grid.
export const layoutModel = createLayoutModel()

export const servicesModel = createServicesModel()

export const collectionsModel = createCollectionsModel({ servicesModel })
export const routesModel = createRoutesModel({ servicesModel })
export const sessionsModel = createSessionsModel({ servicesModel })

export const selectionModel = createSelectionModel({ servicesModel })

export const collectionModel = createCollectionModel({ servicesModel })
export const routeModel = createRouteModel({ servicesModel })

export const playgroundModel = createPlaygroundModel({ servicesModel, routeModel })

sample({
  clock: PageGate.open,
  target: [logsModel.startLogStream, servicesModel.load],
})

// The active service seeds (boot) and switches (top bar) the per-instance views:
// catalog, collections, its selection, and sessions are all scoped to it.
sample({
  clock: servicesModel.$active,
  target: [collectionsModel.load, routesModel.load, sessionsModel.load, selectionModel.load],
})

// A control mutation echoes the new Selection — push it straight into the
// selection model (refreshes overrides + the active-collection marker).
sample({
  clock: collectionsModel.selectionChanged,
  target: selectionModel.put,
})

// The active collection's resolved entries (the pinnable rows) follow the selection.
sample({
  clock: selectionModel.$collection,
  filter: Boolean,
  target: collectionModel.load,
})
