/**
 * Package version, sent in the User-Agent.
 *
 * Duplicated from package.json because reading package.json at runtime forces
 * either a JSON import assertion or a filesystem read, and both make the
 * package harder to bundle. The conformance test asserts this constant,
 * package.json and the OpenAPI document all carry the same version.
 */
export const VERSION = '1.0.0';
