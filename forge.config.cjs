const path = require("node:path");

const packagedRuntimeModules = ["electron-squirrel-startup", "debug", "ms"];

module.exports = {
  packagerConfig: {
    asar: true,
    prune: false,
    executableName: "codex-design-studio",
    appBundleId: "com.codexdesignstudio.app",
    appCategoryType: "public.app-category.graphics-design",
    icon: process.platform === "win32" ? "desktop/assets/icon.ico" : "desktop/assets/icon.icns",
    ignore: (filePath) => {
      const normalized = filePath.replaceAll("\\", "/");
      if (!normalized) return false;
      const runtimeModule = packagedRuntimeModules.some((name) => (
        normalized === `/node_modules/${name}` || normalized.startsWith(`/node_modules/${name}/`)
      ));
      return !(
        normalized === "/package.json" ||
        normalized === "/desktop" ||
        normalized === "/desktop/main.cjs" ||
        normalized === "/desktop/preload.cjs" ||
        normalized === "/desktop/preload-api.cjs" ||
        normalized === "/desktop/workspace-ipc.cjs" ||
        normalized === "/desktop/workspace-registry.cjs" ||
        normalized === "/node_modules" ||
        runtimeModule
      );
    },
    extraResource: [
      "desktop-runtime/studio-server",
      "desktop-runtime/studio-runtime"
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "CodexDesignStudio",
        authors: "jberdah",
        description: "Local-first AI creative workspace powered by GPT-5.6 and Codex.",
        setupIcon: path.join(__dirname, "desktop", "assets", "icon.ico")
      }
    }
  ]
};
