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

import {Runner, RunnerOptions} from '../runner';

/**
 * Just a convenience function to build an object suitable for use as options
 * to the constructor.  Argument contains key/value pairs to layer on top of
 * the minimum options.
 */
function minOptions(options?: Object): RunnerOptions {
  const base = {githubToken: 'TOP_SECRET', tests: []};
  if (options) {
    for (const option in options) {
      base[option] = options[option];
    }
  }
  return base;
}

suite('Runner', () => {

  suite('constructor', () => {

    test('can be called with minimal options', () => {
      assert.doesNotThrow(() => new Runner(minOptions()));
    });
  });
});
