export type { CustomFunction, InputSignature } from '@decoy/core'
export {
  type ControlConfig,
  type DecoyConfig,
  defineConfig,
  type JmespathConfig,
  type PassthroughConfig,
  type RequestLogConfig,
  type ServiceConfig,
} from './define-config'
export { validateJmespath } from './jmespath'
export {
  type LoadedService,
  loadConfig,
  loadConfigs,
  type ResolvedControl,
  type ResolvedPassthrough,
  type ResolvedRequestLog,
  resolveAllWatchPaths,
  resolveWatchPaths,
  validateConfig,
} from './load'
export { MOCK_EXTENSIONS, parseDataFile } from './parse'
export {
  type LogPathContext,
  resolveLogPath,
  unknownTemplateTokens,
  validateRequestLog,
} from './request-log'
export {
  formatIssues,
  hasErrors,
  type Severity,
  ValidationError,
  type ValidationIssue,
  validateSources,
} from './validate'
