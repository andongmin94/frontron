import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: [
    "src/index",
    "src/core/index",
    "src/window/index",
    "src/tray/index",
    "src/store/index",
    "src/bootstrap/index",
    "src/updater/index",
    "src/migrate/index",
    "src/migrate/cli",
  ],
  clean: true,
  declaration: true,
  rollup: {
    esbuild: {
      target: "node22",
      minify: false,
    },
    inlineDependencies: true,
  },
});
