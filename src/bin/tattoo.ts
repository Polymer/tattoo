#!/usr/bin/env node
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

import {CliOptions, getCommandLineOptions, showCliHelp, loadConfigFileOptions, mergeConfigFileOptions, ensureGitHubToken} from '../cli';
import {Runner, RunnerOptions} from '../runner';

async function main() {
  console.time('tattoo');
  try {
    const cliOptions: CliOptions = getCommandLineOptions();
    showCliHelp(cliOptions);
    mergeConfigFileOptions(cliOptions, loadConfigFileOptions(cliOptions));
    ensureGitHubToken(cliOptions);
    const runnerOptions: RunnerOptions = {
      excludes: cliOptions['exclude'],
      githubToken: cliOptions['github-token'],
      fresh: cliOptions['fresh'],
      // TODO(usergenic): Not Yet Implemented
      // latestRelease: cliOptions['latest-release'],
      requires: cliOptions['require'],
      skipTests: cliOptions['skip-test'],
      tests: cliOptions['test'],
      verbose: cliOptions['verbose'],
      wctFlags: cliOptions['wct-flags'],
      workspaceDir: cliOptions['workspace-dir']
    };
    const runner: Runner = new Runner(runnerOptions);
    await runner.run();
  } catch (err) {
    // Report the error and crash.
    console.error('\n\n');
    console.error(err.stack || err);
    process.exit(1);
  }
  console.timeEnd('tattoo');
}

main();
