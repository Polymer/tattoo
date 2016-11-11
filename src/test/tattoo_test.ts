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

import * as model from '../model';
import {Tattoo} from '../tattoo';

/**
 * Just a convenience function to build an object suitable for use as options
 * to tattoo constructor.  Argument contains key/value pairs to layer on top of
 * the minimum options.
 */
function minOptions(options?: Object): model.Options {
  const base = {'github-token': 'TOP_SECRET'};
  if (options) {
    for (const option in options) {
      base[option] = options[option];
    }
  }
  return base;
};

suite('Tattoo', () => {

  suite('constructor', () => {

    test('can be called with minimal options', () => {
      assert.doesNotThrow(() => {
        new Tattoo(minOptions());
      });
    });

    // TODO(usergenic):  Get error to print and process to exit at top level for
    // certain errors, but don't call process.exit inside Tattoo directly.
    test('can not be constructed without options', () => {
      assert.throw(() => {
        new Tattoo();
      });
    });

    // TODO(usergenic):  Get error to print and process to exit at top level for
    // certain errors, but don't call process.exit inside Tattoo directly.
    // This test actually causes the process.exit code which is untestable, so
    // am marking skip.
    test.skip('can not be constructed with empty options', () => {
      assert.throw(() => {
        new Tattoo({});
      });
    });
  });

  suite('config-file', () => {

    test('malformed file', () => {
      assert.throw(() => {
        new Tattoo({'config-file': 'test/malformed.json'});
      });
    });

    test('missing file', () => {
      assert.doesNotThrow(() => {
        new Tattoo(minOptions({'config-file': 'test/does_not_exist.json'}));
      });
    });

    test('empty object file', () => {
      assert.doesNotThrow(() => {
        new Tattoo(minOptions({'config-file': 'test/empty.json'}));
      });
    });
  });
});
