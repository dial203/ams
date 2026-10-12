// Metro config for the pnpm workspace (root .npmrc: node-linker=hoisted).
// - `@ams/shared` is consumed as TypeScript source from packages/shared, so Metro must watch
//   the repository root and resolve from both node_modules folders.
// - `open-wearables` (Open Wearables React Native SDK) is not on npm yet. When it is not
//   installed, imports of it resolve to a local stub that reports health sync as unavailable.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

function isInstalled(name) {
  try {
    require.resolve(`${name}/package.json`, { paths: [projectRoot] });
    return true;
  } catch {
    return false;
  }
}

if (!isInstalled("open-wearables")) {
  const stub = path.resolve(projectRoot, "src/lib/health/ow-sdk-stub.ts");
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === "open-wearables") {
      return { type: "sourceFile", filePath: stub };
    }
    return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
