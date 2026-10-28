/**
 * What rylease's own tools, like `@rylease/cli`, use beyond the public API.
 * Unstable: it changes with them, in any release.
 */
export { main as runAction } from "./config/action.ts";
export { configuredRelease } from "./config/load.ts";
export { reportOutputs } from "./config/outputs.ts";
export { provideSelf } from "./config/self.ts";
export { formatChangeFile, slug } from "./steps/change-files/parse.ts";
export { detectRepo } from "./utils/git.ts";
