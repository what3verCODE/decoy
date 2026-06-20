import { createEvent, createStore, sample } from 'effector'
import { createGate } from 'effector-react'
import { createCollectionModel } from './create-collection-model'
import { createCollectionsModel } from './create-collections-model'
import { createLogsModel } from './create-logs-model'
import { createPlaygroundModel } from './create-playground-model'
import { createRouteModel } from './create-route-model'
import { createRoutesModel } from './create-routes-model'
import { createSelectionModel } from './create-selection-model'
import { createServicesModel } from './create-services-model'
import { createSessionsModel } from './create-sessions-model'

export const PageGate = createGate()

type View = 'catalog' | 'sessions'

export const $view = createStore<View>('catalog')

export const showCatalog = createEvent()
export const showSessions = createEvent()

export const logsModel = createLogsModel()

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

// Re-fetch the sessions list each time the user opens the sessions view.
sample({
  clock: showSessions,
  target: sessionsModel.load,
})

sample({
  clock: showCatalog,
  fn: () => 'catalog' as const,
  target: $view,
})

sample({
  clock: showSessions,
  fn: () => 'sessions' as const,
  target: $view,
})
