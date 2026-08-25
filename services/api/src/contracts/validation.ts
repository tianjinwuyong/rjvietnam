import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiModuleCatalog } from "./api-contract";
import { apiModules } from "../app";

export type ApiRouteIndex = Record<string, Set<string>>;

export type ApiContractValidationIssue = {
  type: "duplicate-route" | "missing-module-route" | "missing-openapi-path" | "missing-openapi-method";
  routeKey: string;
  details: string;
};

export function createRouteKey(method: string, routePath: string): string {
  return `${method.toUpperCase()} ${routePath.replace(/:([a-zA-Z_]+)/g, '{$1}')}`;
}

export function buildRouteIndex(routes: readonly { method: string; path: string }[]): ApiRouteIndex {
  const index: ApiRouteIndex = {};

  for (const route of routes) {
    const normalizedPath = route.path.replace(/:([a-zA-Z_]+)/g, '{$1}');
    const methods = index[normalizedPath] ?? new Set<string>();
    methods.add(route.method.toUpperCase());
    index[normalizedPath] = methods;
  }

  return index;
}

export function parseOpenApiRouteIndex(openApiYaml: string): ApiRouteIndex {
  const index: ApiRouteIndex = {};
  let currentPath: string | null = null;

  for (const rawLine of openApiYaml.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    const pathMatch = line.match(/^  (\/[^:]+):$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      if (!index[currentPath]) {
        index[currentPath] = new Set<string>();
      }
      continue;
    }

    // Accept both expanded OpenAPI operations (`get:`) and valid inline YAML
    // operations (`get: { ... }`). The catalog validator only needs the
    // path/method index; schema validation remains the OpenAPI parser's job.
    const methodMatch = currentPath ? line.match(/^    (get|post|put|patch|delete):(?:\s.*)?$/) : null;
    if (methodMatch && currentPath) {
      index[currentPath].add(methodMatch[1].toUpperCase());
    }
  }

  return index;
}

export function loadOpenApiRouteIndex(): ApiRouteIndex {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const openApiPath = path.join(__dirname, "..", "..", "openapi.yaml");
  const openApiYaml = fs.readFileSync(openApiPath, "utf8");
  return parseOpenApiRouteIndex(openApiYaml);
}

export function validateApiContract(): ApiContractValidationIssue[] {
  const issues: ApiContractValidationIssue[] = [];
  const catalogIndex = buildRouteIndex(apiModuleCatalog.flatMap((module) => module.endpoints));
  const openApiIndex = loadOpenApiRouteIndex();
  const moduleKeys = new Set(apiModules.map((module) => module.key));

  for (const module of apiModules) {
    const catalogModule = apiModuleCatalog.find((entry) => entry.key === module.key);
    if (!catalogModule) {
      issues.push({
        type: "missing-module-route",
        routeKey: module.key,
        details: `No catalog entry was found for module ${module.key}`,
      });
      continue;
    }
  }

  for (const module of apiModuleCatalog) {
    if (!moduleKeys.has(module.key)) {
      issues.push({
        type: "missing-module-route",
        routeKey: module.key,
        details: `API catalog contains an unknown module ${module.key}`,
      });
    }
  }

  const seenRoutes = new Set<string>();
  for (const endpoint of apiModuleCatalog.flatMap((module) => module.endpoints)) {
    const routeKey = createRouteKey(endpoint.method, endpoint.path);
    if (seenRoutes.has(routeKey)) {
      issues.push({
        type: "duplicate-route",
        routeKey,
        details: `Duplicate route declared in API catalog: ${routeKey}`,
      });
      continue;
    }
    seenRoutes.add(routeKey);

    const openApiMethods = openApiIndex[endpoint.path.replace(/:([a-zA-Z_]+)/g, '{$1}')];
    if (!openApiMethods) {
      issues.push({
        type: "missing-openapi-path",
        routeKey,
        details: `OpenAPI path is missing for ${endpoint.path}`,
      });
      continue;
    }

    if (!openApiMethods.has(endpoint.method.toUpperCase())) {
      issues.push({
        type: "missing-openapi-method",
        routeKey,
        details: `OpenAPI method ${endpoint.method} is missing for ${endpoint.path}`,
      });
    }
  }

  for (const module of apiModules) {
    for (const route of module.routes) {
      const routeKey = createRouteKey(route.method, route.path);
      const normalizedPath = route.path.replace(/:([a-zA-Z_]+)/g, '{$1}');
      const openApiMethods = openApiIndex[normalizedPath];
      if (!catalogIndex[normalizedPath]?.has(route.method.toUpperCase())) {
        issues.push({
          type: "missing-module-route",
          routeKey,
          details: `API catalog does not include module route ${routeKey}`,
        });
      }

      if (!openApiMethods?.has(route.method.toUpperCase())) {
        issues.push({
          type: "missing-openapi-method",
          routeKey,
          details: `OpenAPI does not include module route ${routeKey}`,
        });
      }
    }
  }

  return issues;
}

export function assertApiContract(): void {
  const issues = validateApiContract();
  if (issues.length > 0) {
    const message = issues.map((issue) => `${issue.type}: ${issue.details}`).join("; ");
    throw new Error(`API contract validation failed: ${message}`);
  }
}
