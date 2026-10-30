export type {
  Diagnostic,
  EnvironmentCatalog,
  EnvironmentGroup,
  EnvironmentItem,
  EnvRequirement,
  FieldSpec,
  NodeCatalogItem,
  NodeSpec,
  TypeDef,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from './schema.js';

export {
  validateEnvironmentCatalog,
  validateNodeSpec,
  validateTypeDef,
  validateWorkflowDocument,
  type ValidateResult,
} from './validate.js';

export { extractMetaFromTs, type ExtractMetaResult as ExtractMetaFromTsResult } from './extract-ts.js';
export { extractMetaFromPy, type ExtractMetaResult as ExtractMetaFromPyResult } from './extract-py.js';

export { isCompatible, collectRefs } from './compatibility.js';
export { scanNodesDir, type ScanNodesDirOpts } from './catalog.js';
