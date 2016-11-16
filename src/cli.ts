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
'use strict';

import * as cliArgs from 'command-line-args';
import * as fs from 'fs';
import {Runner, RunnerOptions} from './runner';

export interface CliOptions {
  'config-file'?: string;
  'exclude-repo'?: string[];
  'github-token'?: string;
  'fresh'?: boolean;
  'help'?: boolean;
  'latest-release'?: boolean;
  'repo'?: string[];
  'skip-test'?: string[];
  'test'?: string[];
  'verbose'?: boolean;
  'wct-flags'?: string[];
  'workspace-dir'?: string;
}

export interface ConfigFileOptions {
  'exclude-repo'?: string[];
  'github-token'?: string;
  'fresh'?: boolean;
  'latest-release'?: boolean;
  'repo'?: string[];
  'skip-test'?: string[];
  'test'?: string[];
  'verbose'?: boolean;
  'wct-flags'?: string[];
  'workspace-dir'?: string;
}

/**
 * TODO(usergenic): Right now these args produce RunnerOptions-- we should look
 * at separating those so RunnerOptions doesn't include the 'config-file' or
 * 'help' keys, for example, which are not meaningful to it.
 */
const cli = cliArgs([
  {name: 'help', alias: 'h', type: Boolean, description: 'Print usage.'},
  {
    name: 'config-file',
    alias: 'c',
    type: String,
    defaultValue: 'tattoo_config.json',
    description:
        'Specify path to a json file which contains base configuration' +
        ' values.  Command-line options flags supercede values in file ' +
        ' where they differ.  If file is missing, Tattoo will ignore.'
  },
  {
    name: 'exclude-repo',
    alias: 'e',
    type: String,
    defaultValue: [],
    multiple: true,
    description:
        'Repositories not to load.  Overrides the values from the --repo' +
        ' flag.'
  },
  {
    name: 'fresh',
    alias: 'f',
    type: Boolean,
    description:
        'Set to clone all repos from remote instead of updating local copies.'
  },
  {
    name: 'github-token',
    alias: 'g',
    type: String,
    description: 'Provide github token via command-line flag instead of ' +
        '"github-token" file.'
  },
  {
    name: 'latest-release',
    alias: 'l',
    type: Boolean,
    defaultValue: false,
    description: 'Set to update repos to the latest release when possible.'
  },
  {
    name: 'repo',
    alias: 'r',
    type: String,
    defaultValue: [],
    multiple: true,
    description:
        'Explicit repos to load. Specifying explicit repos will disable' +
        'running on the default set of repos for the user.'
  },
  {
    name: 'skip-test',
    alias: 's',
    type: String,
    defaultValue: [],
    multiple: true,
    description:
        'Repositories not to test.  Overrides the values from the --test'
  },
  {
    name: 'test',
    type: String,
    defaultValue: [],
    multiple: true,
    alias: 't',
    description:
        'Repositories to test. All dependencies must be specified with --repo' +
        ' or be included in the config file under repos.'
  },
  {
    name: 'verbose',
    alias: 'v',
    type: Boolean,
    defaultValue: false,
    description: 'Set to print output from failed tests.'
  },
  {
    name: 'wct-flags',
    alias: 'w',
    multiple: true,
    type: String,
    defaultValue: ['-b chrome'],
    description: 'Set to specify flags passed to wct.'
  },
  {
    name: 'workspace-dir',
    alias: 'd',
    type: String,
    description:
        'Override the default path "repos" where the repositories will be ' +
        ' cloned and web-components-tester will run.'
  }
]);

/**
 * Checks for github-token in the RunnerOptions and if not specified, will look
 * in the github-token file in working folder.  If that doesn't exist either,
 * we message to the user that we need a token and exit the process.
 */
function ensureGitHubToken(options: CliOptions) {
  // TODO(usergenic): Maybe support GITHUB_TOKEN as an environment variable,
  // since this would be a better solution for Travis deployments etc.
  if (!options['github-token']) {
    try {
      options['github-token'] = fs.readFileSync('github-token', 'utf8').trim();
    } catch (e) {
      console.error(`
You need to create a github token and place it in a file named 'github-token'.
The token only needs the 'public repos' permission.

Generate a token here:   https://github.com/settings/tokens
    `);
      process.exit(1);
    }
  }
}

/**
 * Reads and parses the json config file content if the filename is specified
 * and the file exists.  If it is not specified or does not exist, returns empty
 * options object.  Will throw on malformed file only.
 */
function loadConfigFileOptions(options: CliOptions): ConfigFileOptions {
  if (!options['config-file']) {
    return {};
  }

  const configFile = options['config-file'];

  try {
    if (fs.lstatSync(configFile)) {
      // TODO(usergenic): Test for file presence and provide proper error
      // message.
      return JSON.parse(fs.readFileSync(configFile, 'utf8'));
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {};
    }
    throw(err);
  }

  return {};
}

/**
 * Loads the config file specified in the options as 'config-file' and merges
 * the values into the provided options as appropriate.
 */
function mergeConfigFileOptions(
    options: CliOptions, cfOptions: ConfigFileOptions) {
  function mergeArray(name: string) {
    if (typeof cfOptions[name] !== 'undefined') {
      // Fix values that aren't in Array.
      if (typeof cfOptions[name] === 'string') {
        cfOptions[name] = [cfOptions[name]];
      }
      options[name].push.apply(options[name], cfOptions[name]);
    }
  }

  function mergeBasic(name: string, type: string) {
    if ((typeof cfOptions[name] === type) && (typeof options[name] !== type)) {
      options[name] = cfOptions[name];
    }
  }

  mergeArray('exclude-repo');
  mergeBasic('github-token', 'string');
  mergeBasic('fresh', 'boolean');
  mergeBasic('latest-release', 'boolean');
  mergeArray('repo');
  mergeArray('skip-test');
  mergeArray('test');
  mergeBasic('verbose', 'boolean');
  mergeArray('wct-flags');
  mergeBasic('workspace-dir', 'string');
}


/**
 * Displays the usage information for the CLI if requested in options.
 */
function showCliHelp(options: CliOptions) {
  if (options.help) {
    console.log(cli.getUsage({
      header: 'tattoo runs many tests at various branches!!',
      title: 'tattoo'
    }));
    process.exit(0);
  }
}

async function main() {
  console.time('tattoo');
  try {
    const cliOptions: CliOptions = cli.parse();
    showCliHelp(cliOptions);
    mergeConfigFileOptions(cliOptions, loadConfigFileOptions(cliOptions));
    ensureGitHubToken(cliOptions);
    const runnerOptions: RunnerOptions = {
      excludeRepos: cliOptions['exclude-repo'],
      githubToken: cliOptions['github-token'],
      fresh: cliOptions['fresh'],
      latestRelease: cliOptions['latest-release'],
      repos: cliOptions['repo'],
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
