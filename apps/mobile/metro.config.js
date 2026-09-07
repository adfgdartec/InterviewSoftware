const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Metro, taught three things it does not do by default. Each was found by running
 * `expo export`, not by typechecking -- tsc resolves all of them natively, so the app
 * typechecked cleanly while being impossible to bundle.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. This is a pnpm monorepo. The workspace packages live outside the app directory and
//    resolve through symlinks, so Metro has to watch the root and know where to look.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// NOT `disableHierarchicalLookup`. That flag suits a hoisted npm/yarn monorepo; pnpm keeps
// each package's dependencies in its own nested node_modules, so switching the upward walk
// off makes a package unable to resolve ITSELF -- expo-router failed on its own
// `build/qualified-entry` import with it on.

// 2. `@loopcraft/core/catalog` is a package-exports subpath, which Metro ignores by default.
//    Turning on `unstable_enablePackageExports` globally DOES fix it -- and immediately breaks
//    expo-router, which deep-imports its own `build/qualified-entry`, a path its exports map
//    does not list. Enforcing exports maps everywhere is too big a lever for one import, so
//    the workspace subpaths are resolved explicitly below instead.
const WORKSPACE_SUBPATHS = {
  '@loopcraft/core/catalog': path.resolve(workspaceRoot, 'packages/core/src/catalog.ts'),
};

// 3. The workspace packages are TypeScript SOURCE written in the NodeNext style, where a
//    relative import of a .ts file is spelled `.js`. Metro looks for a literal `.js` file and
//    does not find it. This maps the extension back, and only for paths that actually exist
//    as TypeScript -- so a genuine .js import still resolves to the .js file.
const resolveTsSource = (context, moduleName, platform) => {
  const workspaceTarget = WORKSPACE_SUBPATHS[moduleName];
  if (workspaceTarget !== undefined) {
    return { type: 'sourceFile', filePath: workspaceTarget };
  }
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const base = path.resolve(path.dirname(context.originModulePath), moduleName.slice(0, -3));
    for (const ext of ['.ts', '.tsx']) {
      if (fs.existsSync(base + ext)) {
        return { type: 'sourceFile', filePath: base + ext };
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};
config.resolver.resolveRequest = resolveTsSource;

module.exports = config;
