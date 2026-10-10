export { detectProject, explainDetection, findRoot } from "./detect";
export { MAX_STATIC_PAGES, STATIC_IGNORED_DIRS, hasRootHtml, normalizePagePath, scanHtmlPages, type StaticInfo, type StaticScan } from "./static";
export { splitCommand, tokenizeCommand } from "./command";
export {
  DetectionError,
  ExecutionPlanSchema,
  PACKAGE_MANAGERS,
  type DetectOptions,
  type DetectOverrides,
  type DetectionFailure,
  type DetectionResult,
  type ExecutionPlan,
  type FrameworkInfo,
  type PackageManagerName,
  type Reason,
} from "./types";
