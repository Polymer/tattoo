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
import * as gitUtil from './git-util';
import * as model from './model';
import {Tattoo} from './tattoo';

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
    description:
        'Provide github token via command-line flag instead of "github-token" file.'
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

async function main() {
  console.time('tattoo');
  try {
    const options: model.Options = cli.parse();
    if (options.help) {
      console.log(cli.getUsage({
        header: 'tattoo runs many tests at various branches!!',
        title: 'tattoo'
      }));
      process.exit(0);
    }
    const tattoo: Tattoo = new Tattoo(options);
    await tattoo.run();
  } catch (err) {
    // Report the error and crash.
    console.error('\n\n');
    console.error(err.stack || err);
    process.exit(1);
  }
  console.timeEnd('tattoo');
}

main();
