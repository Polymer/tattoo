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

import * as commandLineArgs from 'command-line-args';
import * as fs from 'fs';
import * as path from 'path';
import {Runner, RunnerOptions} from './runner';

export interface CliOptions {
  'color'?: string;
  'config-file'?: string;
  'exclude'?: string[];
  'github-token'?: string;
  'fresh'?: boolean;
  'help'?: boolean;
  'require'?: string[];
  'skip-test'?: string[];
  'test'?: string[];
  'verbose'?: boolean;
  'version'?: boolean;
  'wct-flags'?: string[];
  'workspace-dir'?: string;
}

export interface ConfigFileOptions {
  'color'?: string;
  'exclude'?: string[];
  'github-token'?: string;
  'fresh'?: boolean;
  'require'?: string[];
  'skip-test'?: string[];
  'test'?: string[];
  'verbose'?: boolean;
  'wct-flags'?: string[];
  'workspace-dir'?: string;
}

export function getCommandLineOptions(): CliOptions {
  const argv = process.argv.slice(2).map((arg) => {
    // HACK(usergenic): The command-line-args package has a problem with values
    // of flags that look like flags.  To work around this problem, we prefix
    // all dash-prefixed values with a space in any assignment-style flag that
    // uses a '=' so that the values don't get matched as potential options.
    // To remove the space prefix, we trim all string attributes.
    const match = arg.match(/^(--\S+|-\S)=(?:"(-.+)"|'(-.+)'|(-.+))$/);
    if (match) {
      return `${match[1]}= ${match[2] || match[3] || match[4]}`;
    } else {
      return arg;
    }
  });
  const cliOptions = <CliOptions>commandLineArgs(cliOptionDefinitions, argv);
  for (const option
           of ['test', 'exclude', 'skip-test', 'require', 'wct-flags']) {
    if (cliOptions[option]) {
      cliOptions[option] = cliOptions[option].map((str) => str.trim());
    }
  }
  for (const option of ['config-file', 'github-token', 'workspace-dir']) {
    if (cliOptions[option]) {
      cliOptions[option] = cliOptions[option].trim();
    }
  }
  return cliOptions;
}

// TODO(usergenic): Consider a -b --bower-flags argument.
export const cliOptionDefinitions = [
  {
    name: 'test',
    alias: 't',
    type: String,
    defaultValue: [],
    multiple: true,
    description: 'Repositories to test.  (This is the default option, so the ' +
        '--test/-t switch itself is not required.)',
    defaultOption: true
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
    name: 'require',
    alias: 'r',
    type: String,
    defaultValue: [],
    multiple: true,
    description:
        'Explicit repos to load. Specifying explicit repos will disable' +
        ' running on the default set of repos for the user.'
  },
  {
    name: 'exclude',
    alias: 'e',
    type: String,
    defaultValue: [],
    multiple: true,
    description:
        'Repositories not to load.  Overrides the values from the --repo' +
        ' and --test flag.'
  },
  {
    name: 'fresh',
    alias: 'f',
    type: Boolean,
    description:
        'Set to clone all repos from remote instead of updating local copies.'
  },
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
    name: 'color',
    alias: 'C',
    type: String,
    defaultValue: 'on',
    description:
        'Set to "off" if you do not want color in your output.  Defaults ' +
        'to "on".'
  },
  {
    name: 'github-token',
    alias: 'g',
    type: String,
    description: 'Provide github token via command-line flag instead of ' +
        '"github-token" file.'
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
    description: 'Set to specify flags passed to wct.'
  },
  {
    name: 'workspace-dir',
    alias: 'd',
    type: String,
    description:
        'Override the default path "tattoo_workspace" where the repositories' +
        ' will be cloned and web-component-tester will run.'
  },
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Print this usage example.'
  },
  {
    name: 'version',
    alias: 'V',
    type: Boolean,
    defaultValue: false,
    description: 'Print out the version of tattoo.'
  }
];

/**
 * Checks for github-token in the RunnerOptions and if not specified, will look
 * in the github-token file in working folder.  If that doesn't exist either,
 * we message to the user that we need a token and exit the process.
 */
export function ensureGitHubToken(options: CliOptions) {
  // TODO(usergenic): Maybe support GITHUB_TOKEN as an environment variable,
  // since this would be a better solution for Travis deployments etc.
  if (!options['github-token']) {
    try {
      options['github-token'] = fs.readFileSync('github-token', 'utf8').trim();
    } catch (e) {
      const err = new Error(`
You need to create a github token and place it in a file named 'github-token'.
The token only needs the 'public repos' permission.

Generate a token here:   https://github.com/settings/tokens
`);
      err.stack = undefined;
      throw err;
    }
  }
}

/**
 * Reads and parses the json config file content if the filename is specified
 * and the file exists.  If it is not specified or does not exist, returns empty
 * options object.  Will throw on malformed file only.
 */
export function loadConfigFileOptions(options: CliOptions): ConfigFileOptions {
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
export function mergeConfigFileOptions(
    options: CliOptions, cfOptions: ConfigFileOptions) {
  function mergeArray(name: string) {
    if (typeof cfOptions[name] !== 'undefined') {
      // Fix values that aren't in Array.
      if (typeof cfOptions[name] === 'string') {
        cfOptions[name] = [cfOptions[name]];
      }
      options[name] = options[name] ? options[name].concat(cfOptions[name]) :
                                      cfOptions[name];
    }
  }

  function mergeBasic(name: string, type: string) {
    if ((typeof cfOptions[name] === type) && (typeof options[name] !== type)) {
      options[name] = cfOptions[name];
    }
  }

  mergeBasic('color', 'string');
  mergeArray('exclude');
  mergeBasic('github-token', 'string');
  mergeBasic('fresh', 'boolean');
  mergeArray('repo');
  mergeArray('skip-test');
  mergeArray('test');
  mergeBasic('verbose', 'boolean');
  mergeArray('wct-flags');
  mergeBasic('workspace-dir', 'string');
}

/**
 * Produces the usage information to display for the --help/-h option.
 */
export function getCliHelp(): string {
  return require('command-line-usage')([
    {
      header: 'tattoo (test all the things over & over)',
      content:
          `Runs the web-component-tester on custom element git repositories.

  Run test for a specific GitHub repository:
    $ tattoo PolymerElements/paper-button

  Run test for a whole bunch of GitHub repositories:
    $ tattoo PolymerElements/paper-*

  See more examples at https://github.com/Polymer/tattoo`
    },
    {header: 'Options', optionList: cliOptionDefinitions}
  ]);
}

/**
 * Gets the version number from the package.json
 */
export function getVersion(): string {
  const packageJsonFilename = path.join(__dirname, '../package.json');
  const packageJson = fs.readFileSync(packageJsonFilename).toString();
  const packageData = JSON.parse(packageJson);
  return packageData['version'];
}
