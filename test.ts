/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

"use strict";

import {ElementRepo} from "./element-repo";
import {TestResult, TestResultValue} from "./test-result";
import {existsSync} from "./util";

import * as child_process from "child_process";
import * as path from "path";
import * as resolve from "resolve";

class CompletedProcess {
  status: TestResultValue;
  stdout: string;
  stderr: string;
  constructor ({status = 0, stdout = null, stderr = null}) {
    if (status == null) {
      throw new Error("status must not be null.");
    }
    this.status = status;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

type ProcessResult = CompletedProcess | Error;

export async function test(element: ElementRepo, flags: string[]): Promise<TestResult> {
  const dir = element.dir;
  let testValue: TestResultValue;
  let testOutput: string;
  const wctCommand = "wct";
  let spawnWct = new Promise<ProcessResult>(
    (resolve, reject) => {
      const exists = existsSync(path.join(element.dir, "test"));
      if (!exists) {
        resolve(new CompletedProcess({status: TestResultValue.skipped}));
        return;
      }
      const spawnParams = {
        cwd: element.dir
      };
      // Something about the buffering or VM reuse of child_process.exec
      // interacts extraordinarily poorly with wct, forcing the use
      // of child_process.spawn.

      const child = child_process.spawn(wctCommand, flags, spawnParams);
      let output = "";
      child.stdout.on("data", (data: Buffer | string) => {
          output += data;
      });
      child.on("exit", (code: number) => {
        const value =
            code === 0 ? TestResultValue.passed : TestResultValue.failed;
        resolve(new CompletedProcess({status: value, stdout: output}));
      });
      child.on("error", (err: Error) => {
        console.log(output);
        reject(err);
      });
  });
  let flakeRuns = 2;
  let wctStatus = await spawnWct;
  while (flakeRuns > 0) {
    flakeRuns--;
    if (wctStatus instanceof CompletedProcess && wctStatus.status === TestResultValue.failed) {
      wctStatus = await spawnWct;
    } else {
      break;
    }
  }

  let testStatus = TestResultValue.passed;
  let output: string;
  if (wctStatus instanceof Error) {
    output = wctStatus.toString();
    testStatus = TestResultValue.failed;
  } else if (wctStatus instanceof CompletedProcess) {
    testStatus = wctStatus.status;
    output = wctStatus.stdout;
  }
  return {
    result: testStatus,
    output: output,
    elementRepo: element
  };
}
