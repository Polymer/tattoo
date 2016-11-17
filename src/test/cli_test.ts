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

import {assert, AssertionError, expect, use} from 'chai';
import * as fs from 'fs';

import * as cli from '../cli';

suite('cli', () => {
  use(require('chai-diff'));

  /**
   * Currently the output of the CLI help is embedded in the README.md because
   * it is convenient.  This test ensures we keep it up to date.  You can
   * generate new help output for the README at any time by typing the
   * following:
   *
   *     stty columns 80 && node lib/bin/tattoo.js -h && stty columns -1
   *
   */
  test('README.md embedded CLI help output', () => {
    const readme = fs.readFileSync('README.md', 'utf8').trim();
    // HACK(usergenic): Force process to report its width to desired number
    // of columns for the README output, because the table-layout package
    // uses this to shrink columns and wrap text to map to adjust to shell's
    // dimension.
    const stdoutColumns = process.stdout['columns'];
    const stderrColumns = process.stderr['columns'];
    let generatedHelp;
    try {
      process.stdout['columns'] = 80;
      process.stderr['columns'] = 80;
      generatedHelp =
          require('strip-ansi')(cli.getCliHelp()).trim().replace(/ +$/mg, '');
    } finally {
      process.stdout['columns'] = stdoutColumns;
      process.stderr['columns'] = stderrColumns;
    }
    const helpEmbedOpenText = '```\ntattoo -h\n\n';
    const helpEmbedCloseText = '\n```';
    assert.include(readme, helpEmbedOpenText);
    const helpEmbedOpenAt = readme.indexOf(helpEmbedOpenText);
    assert.notEqual(helpEmbedOpenAt, -1);
    const helpEmbedCloseAt =
        readme.indexOf(helpEmbedCloseText, helpEmbedOpenAt + 1);
    assert.notEqual(helpEmbedCloseAt, -1);
    const helpEmbed = readme.slice(
        helpEmbedOpenAt, helpEmbedCloseAt + helpEmbedCloseText.length);
    expect(helpEmbedOpenText + generatedHelp + helpEmbedCloseText)
        .not['differentFrom'](helpEmbed);
  });
});
