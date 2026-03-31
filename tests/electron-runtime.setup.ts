import { test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const mainBundlePath = path.join(projectDir, "out/main/index.js");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runNpm(args: string[]) {
  execFileSync(npmCommand, args, {
    cwd: projectDir,
    env: process.env,
    stdio: "inherit",
  });
}

test("prepare Electron test runtime", async () => {
  test.setTimeout(180000);

  if (!existsSync(mainBundlePath)) {
    runNpm(["run", "build"]);
  }

  runNpm(["run", "ensure-native"]);
});
