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

import * as git from '../git';

suite('Git', () => {

  suite('parseGitHubRepoRefString', () => {

    test('just owner and repo name', () => {
      assert.deepEqual(
          git.parseGitHubRepoRefString('who/what'),
          {ownerName: 'who', repoName: 'what', checkoutRef: undefined});
    });

    test('owner, repo name and checkout ref', () => {
      assert.deepEqual(
          git.parseGitHubRepoRefString('who/what#where'),
          {ownerName: 'who', repoName: 'what', checkoutRef: 'where'});
    });

    test('with a wildcard repo', () => {
      assert.deepEqual(
          git.parseGitHubRepoRefString('who/*'),
          {ownerName: 'who', repoName: '*', checkoutRef: undefined});
    });

    test('invalid string', () => {
      assert.throws(() => {
        git.parseGitHubRepoRefString('not-valid-repo');
      });
    });
  });

  suite('serializeGitHubRepoRef', () => {

    test('just owner and repo name', () => {
      assert.equal(
          git.serializeGitHubRepoRef(
              {ownerName: 'polymer', repoName: 'tattoo'}),
          'polymer/tattoo');
    });

    test('owner, repo name and checkout ref', () => {
      assert.equal(
          git.serializeGitHubRepoRef({
            ownerName: 'polymer',
            repoName: 'tattoo',
            checkoutRef: 'electric-boogaloo'
          }),
          'polymer/tattoo#electric-boogaloo');
    });
  });
});
