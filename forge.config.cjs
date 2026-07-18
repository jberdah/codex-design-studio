module.exports = {
  packagerConfig: {
    asar: true,
    prune: false,
    executableName: "codex-design-studio",
    appBundleId: "com.codexdesignstudio.app",
    appCategoryType: "public.app-category.graphics-design",
    icon: "desktop/assets/icon.icns",
    ignore: (filePath) => {
      const normalized = filePath.replaceAll("\\", "/");
      if (!normalized) return false;
      return !(
        normalized === "/package.json" ||
        normalized === "/desktop" ||
        normalized === "/desktop/main.cjs"
      );
    },
    extraResource: [
      "desktop-runtime/studio-server",
      "desktop-runtime/studio-runtime"
    ]
  },
  rebuildConfig: {},
  makers: [
    { name: "@electron-forge/maker-zip", platforms: ["darwin"] }
  ]
};
