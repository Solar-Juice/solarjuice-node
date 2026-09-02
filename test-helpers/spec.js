import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A deliberately small reader for spec/openapi.yaml.
 *
 * The conformance test needs three things from the document: the version, and
 * the path plus HTTP method behind every operationId. Pulling those out by
 * indentation keeps the package free of a YAML dependency even in development,
 * which matters because the CI job installs nothing at all.
 *
 * It is not a YAML parser and is not trying to be. Anything it cannot read it
 * ignores, so the conformance test can only ever be too lenient about the rest
 * of the document, never wrong about the operations it does find.
 */

const SPEC_PATH = fileURLToPath(new URL('../spec/openapi.yaml', import.meta.url));
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);

export function readSpec(path = SPEC_PATH) {
  const lines = readFileSync(path, 'utf8').split('\n');

  return {
    version: readInfoVersion(lines),
    operations: readOperations(lines),
  };
}

/** @returns {string|null} info.version */
function readInfoVersion(lines) {
  let inInfo = false;

  for (const line of lines) {
    if (/^\S/.test(line)) inInfo = line.startsWith('info:');
    if (!inInfo) continue;

    const match = /^ {2}version:\s*(\S+)\s*$/.exec(line);
    if (match) return match[1].replace(/^['"]|['"]$/g, '');
  }

  return null;
}

/** @returns {Map<string, {path: string, method: string}>} operationId to route */
function readOperations(lines) {
  const operations = new Map();

  let inPaths = false;
  let currentPath = null;
  let currentMethod = null;

  for (const line of lines) {
    if (/^\S/.test(line)) {
      inPaths = line.startsWith('paths:');
      currentPath = null;
      currentMethod = null;
      continue;
    }
    if (!inPaths || line.trim() === '' || line.trim().startsWith('#')) continue;

    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      currentMethod = null;
      continue;
    }

    const methodMatch = /^ {4}([a-z]+):\s*$/.exec(line);
    if (methodMatch && HTTP_METHODS.has(methodMatch[1])) {
      currentMethod = methodMatch[1];
      continue;
    }

    const operationMatch = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
    if (operationMatch && currentPath && currentMethod) {
      operations.set(operationMatch[1], { path: currentPath, method: currentMethod.toUpperCase() });
    }
  }

  return operations;
}
