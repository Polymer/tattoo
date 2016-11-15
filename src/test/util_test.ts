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

import * as util from '../util';

suite('Util', () => {

  suite('existsSync', () => {

    test('returns true if the file exists', () => {
      assert.equal(util.existsSync('test/this_file_exists'), true);
    });

    test('returns false if the file does not exist', () => {
      assert.equal(util.existsSync('test/this_file_does_not_exist'), false);
    });
  });

  suite('wildcardRegExp', () => {

    test('safely escapes regular expression characters', () => {
      assert.deepEqual(util.wildcardRegExp('cool.js'), /cool\.js/);
      assert.deepEqual(util.wildcardRegExp('f(n){n^2}'), /f\(n\)\{n\^2\}/);
    });

    test('converts "*" in pattern to all character search', () => {
      assert.deepEqual(util.wildcardRegExp('iron-*'), /iron-.*/);
      assert.deepEqual(util.wildcardRegExp('*-*'), /.*-.*/);
    });

    test('can match element names', () => {
      const repoNames = ['iron-list', 'paper-button', 'sad-panda', 'tattoo'];

      const elementRegExp = util.wildcardRegExp('*-*');
      assert.deepEqual(
          repoNames.filter(name => elementRegExp.test(name)),
          ['iron-list', 'paper-button', 'sad-panda']);

      const ironElementRegExp = util.wildcardRegExp('iron-*');
      assert.deepEqual(
          repoNames.filter(name => ironElementRegExp.test(name)),
          ['iron-list']);
    });
  });
});
