/**
 * Offline test isolation: tests must never read or create the user's real
 * world access settings or backups. Point the home folder at a throwaway
 * directory and WA_ACCESS_FILE at a path that does not exist, so any test
 * that forgets to pass its own settings fails loudly instead.
 */

import { mkdtempSync } from "fs";
import http from "http";
import https from "https";
import { tmpdir } from "os";
import { join } from "path";

// Offline means offline: any real HTTP(S) request fails the test.
for (const mod of [http, https])
  for (const fn of ["request", "get"])
    mod[fn] = () => {
      throw new Error("Network access is disabled in offline tests (npm test)");
    };

const fakeHome = mkdtempSync(join(tmpdir(), "wa-test-home-"));
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
process.env.WA_ACCESS_FILE = join(fakeHome, "no-settings-here", "access.json");
