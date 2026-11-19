// The example dashboard (/demo) runs the app's own Convex functions in the browser on made-up data (src/demo/).
// Those functions read the signed-in user through @convex-dev/auth/server, which only runs on Convex, so code bundled
// from convex/ gets a small stand-in (src/demo/authShim.ts) that reads the demo's user instead.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const convexDir = path.join(__dirname, "convex") + path.sep;
const shim = path.join(__dirname, "src", "demo", "authShim.ts");
const resolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@convex-dev/auth/server" && context.originModulePath.startsWith(convexDir)) {
    return { type: "sourceFile", filePath: shim };
  }
  return (resolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
