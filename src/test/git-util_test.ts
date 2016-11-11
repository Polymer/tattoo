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

import {parseRepoExpression} from '../git-util';

suite('Git utils', () => {

  suite('parseRepoExpression', () => {

    test('just owner and name', () => {
      assert.deepEqual(
          parseRepoExpression('who/what'),
          {org: 'who', repo: 'what', name: 'what', ref: undefined});
    });

    test('with an aliased name', () => {
      assert.deepEqual(
          parseRepoExpression('aka:who/what'),
          {org: 'who', repo: 'what', name: 'aka', ref: undefined});
    });

    test('with a ref', () => {
      assert.deepEqual(
          parseRepoExpression('who/what#where'),
          {org: 'who', repo: 'what', ref: 'where', name: 'what'});
    });

    test('with a wildcard repo', () => {
      assert.deepEqual(
          parseRepoExpression('who/*'),
          {org: 'who', repo: '*', name: undefined, ref: undefined});
    });

    test('with a wildcard repo and an aliased name is invalid', () => {
      assert.throws(() => {
        parseRepoExpression('aka:who/*');
      });
    });

    test('invalid string', () => {
      assert.throws(() => {
        parseRepoExpression('not-valid-repo');
      });
    });
  });
});
