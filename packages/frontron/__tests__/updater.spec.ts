import { EventEmitter } from "node:events";

import { expect, test } from "vitest";

import { setupAutoUpdater } from "../src/updater";
import type { AutoUpdaterLike } from "../src/updater";

class FakeUpdater extends EventEmitter implements AutoUpdaterLike {
  async checkForUpdatesAndNotify() {
    this.emit("checking-for-update");
    this.emit("update-not-available");
    return Promise.resolve();
  }
}

test("setupAutoUpdater emits status callbacks and can dispose", async () => {
  const updater = new FakeUpdater();
  const events: string[] = [];

  const controller = setupAutoUpdater({
    updater,
    onStatus(eventName) {
      events.push(eventName);
    },
  });

  await controller.check();
  expect(events).toContain("checking-for-update");
  expect(events).toContain("update-not-available");

  controller.dispose();
  events.length = 0;
  updater.emit("update-downloaded");

  expect(events).toEqual([]);
});
