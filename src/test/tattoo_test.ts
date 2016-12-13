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

/// <reference path="../../node_modules/@types/mocha/index.d.ts" />

import {assert} from 'chai';
import {main} from '../bin/tattoo';
import * as cli from '../cli';

const testConsole = require('test-console');

suite('bin/tattoo', () => {
  interface TestMainResults {
    exitCode?: number;
    stdout?: string[];
    stderr?: string[];
  }
  async function testMain(args: string[]):
      Promise<TestMainResults> {
        const result: TestMainResults = {};
        const stdout = testConsole.stdout.inspect();
        const stderr = testConsole.stderr.inspect();
        try {
          result.exitCode = await main(args);
        } finally {
          result.stdout = stdout.output.join('\n');
          result.stderr = stderr.output.join('\n');
          stdout.restore();
          stderr.restore();
        }
        return result;
      }

  test('Prints out version', async() => {
    const result = await testMain(['--version']);
    assert.include(result.stdout, cli.getVersion());
    assert.equal(result.exitCode, 0);
  });

  test('Prints out usage help', async() => {
    const result = await testMain(['--help']);
    assert.include(result.stdout, cli.getCliHelp());
    assert.equal(result.exitCode, 0);
  });
});
