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

declare function require(name: string): any; try {
  require('source-map-support').install();
} catch (err) {
}

import * as Bottleneck from 'bottleneck';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as hydrolysis from 'hydrolysis';
import * as GitHub from 'github';
import * as nodegit from 'nodegit';
import * as path from 'path';
import * as promisify from 'promisify-node';
import * as rimraf from 'rimraf';
import * as resolve from 'resolve';

import {ElementRepo, PushStatus} from './element-repo';
import * as gitUtil from './git-util';
import * as model from './model';
import {test} from './test';
import {TestResult, TestResultValue} from './test-result';
import * as util from './util';

export class Tattoo {
  private _excludeRepos: string[];
  private _fresh: boolean;
  private _github?: gitUtil.GitHubConnection;
  private _githubToken: string;
  private _githubUser?: GitHub.User;
  private _repos: model.RepoConfig[];
  private _skipTests: string[];
  private _tests: string[];
  private _testRateLimiter: Bottleneck;
  private _wctFlags: string;
  private _workspace: model.Workspace;

  // TODO(usergenic): This constructor is getting long.  Break up some of
  // these stanzas into supporting methods.
  constructor(options: model.Options) {
    this._loadConfigFile(options);
    this._setGitHubToken(options);

    this._excludeRepos = options['exclude-repo'] ? options['exclude-repo'] : [];
    this._fresh = !!options['fresh'];
    this._repos = options['repo'] ? options['repo'] : [];
    this._skipTests = options['skip-test'] ? options['skip-test'] : [];
    this._tests = options['test'] ? options['test'] : [];
    this._wctFlags = options['wct-flags'] ? options['wct-flags'].join(' ') : '';
    this._workspace = {dir: (options['workspace-dir'] || './repos'), repos: {}};
    // TODO(usergenic): Rate limit should be an option.
    this._testRateLimiter = new Bottleneck(1, 100);
  }

  /**
   * Given all the repos defined in the workspace, lets iterate through them
   * and either clone them or update their clones and set them to the specific
   * refs.
   */
  async _cloneOrUpdateWorkspaceRepos() {
    // Clone git repos.
    for (const name in this._workspace.repos) {
      const repoConfig = this._workspace.repos[name];
      /*
      let repoPromise = this._github.cloneRepo({
        owner: repoConfig.org,
        name: repoConfig.repo,
        clone_url: `git@github.com:${repoConfig.org}/${repoConfig.repo}`
      },);
      // TODO(garlicnation): Checkout branch of a repository.
      promises.push(repoPromise);
      */
    }

    await util.promiseAllWithProgress(promises, 'Cloning repos...');
    elements.push.apply(
        elements,
        (await util.promiseAllWithProgress(promises, 'Cloning repos...')));
  }

  /**
   * Connect is basically an initialization routine but involves API calls to
   * GitHub to get information about repos etc, mostly to support wildcarded
   * RepoConfig options and identify invalid/unavailable repos.
   */
  async _connectToGitHub() {
    // TODO(usergenic): Pass an option to gitUtil.connectToGitHub for the
    // rate limiter it uses.
    this._github = gitUtil.connectToGitHub(this._githubToken);

    // Get user information for the owner of the github token.
    this._githubUser = await this._github.getUser();
  }

  async _determineWorkspaceRepos() {
    let allRepos: model.RepoConfig[] = [];

    // This is an index of names of owned repos so we can download the set
    // just once for each owner, in the event we have wildcard in more than
    // one repo config.
    const reposByOwner: {[owner: string]: string[]} = {};

    // Add every explicit repo and every repo from expanding wildcard names.
    for (const repo of this._repos.map(gitUtil.parseRepoExpression)) {
      // If the repo has a name, it is an individual repo, otherwise it has a
      // wildcard in the expression.
      if (repo.name) {
        allRepos.push(repo);
      } else {
        // If we have not downloaded the repo names for this owner before, lets
        // do that.
        if (!reposByOwner[repo.org]) {
          reposByOwner[repo.org] = await this._github.getRepoNames(repo.org);
        }
        // Loop through all the names of the repos for the owner and add
        // RepoConfigs to the allRepos list for every matching one.
        allRepos.push.apply(
            allRepos,
            reposByOwner[repo.org]
                .filter(
                    name =>
                        name.match(new RegExp(repo.repo.replace(/\*/, '.*'))))
                .map(name => ({
                       org: repo.org,
                       name: name,
                       ref: repo.ref,
                       repo: name
                     })));
      }
    }

    // TODO(usergenic): Maybe we should be obtaining the package name here
    // from the repository's bower.json or package.json.

    // TODO(usergenic): Filter out any repos referenced in exclude option.
    for (const exclude of this._excludeRepos) {
      // TODO(usergenic): Support wildcards in excludes.
      // TODO(usergenic): Since excludes don't support wildcards, this match
      // is going to be greedy such that "iron" will match "iron-list" and
      // "iron-image" etc.  Work around is to follow with # like "/iron-list#"
      allRepos = allRepos.filter(
          repo => !gitUtil.serializeRepoConfig(repo).match(exclude));
    }

    // NOTE(usergenic): We might need this here.  The old repo list included
    // hydrolysis:
    // allRepos.push(gitUtil.parseRepoExpression('Polymer/polymer-analyzer'));

    // Build the map of repos by name
    for (const repoConfig of allRepos) {
      // TODO(usergenic): This error is a bit strict and also doesn't reveal
      // enough data to help troubleshoot.  I.e. what is the full config of
      // the existing repo.  Update this message.
      if (this._workspace.repos[repoConfig.name]) {
        throw(`More than repo with name '${repoConfig.name}' defined.`);
      }

      this._workspace.repos[repoConfig.name] = repoConfig;
    }
  }

  _loadConfigFile(options: model.Options) {
    if (!options['config-file']) {
      return;
    }

    const configFile = options['config-file'];
    let cfOptions: model.ConfigFileOptions;

    try {
      if (fs.lstatSync(configFile)) {
        // TODO(usergenic): Test for file presence and provide proper error
        // message.
        cfOptions = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        return;
      }
      throw(err);
    }

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
      if ((typeof cfOptions[name] === type) &&
          (typeof options[name] !== type)) {
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

  async _prepareWorkspaceFolder() {
    // TODO(usergenic): Maybe allow for a configurable directory to clone the
    // repos into.

    // Clean up repos when 'fresh' option is true.
    if (this._fresh) {
      await promisify(rimraf)('repos');
    }

    // Ensure repos folder exists.
    if (!util.existsSync('repos')) {
      fs.mkdirSync('repos');
    }

    // Sometimes a repo will be left in a bad state. Deleting it here
    // will let it get cleaned up later.
    for (let dir of fs.readdirSync('repos')) {
      const repoDir = path.join('repos', dir);
      if (!util.isDirSync(repoDir) || fs.readdirSync(repoDir).length === 1) {
        await promisify(rimraf)(repoDir);
      }
    }
  }

  _setGitHubToken(options: model.Options) {
    // TODO(usergenic): Maybe support GITHUB_TOKEN as an environment variable.
    if (options['github-token']) {
      this._githubToken = options['github-token'];
    } else {
      try {
        this._githubToken = fs.readFileSync('github-token', 'utf8').trim();
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

  async _testAllTheThings() {
  }

  async run() {
    await this._connectToGitHub();
    await this._determineWorkspaceRepos();
    await this._prepareWorkspaceFolder();
    await this._cloneOrUpdateWorkspaceRepos();
    await this._testAllTheThings();
    // TODO(usergenic): Support a --dry-run option.
  }
}


/**
 * Returns a Promise of a list of Polymer github repos to automatically
 * cleanup / transform.
 */
async function getRepos():
    Promise<GitHub.Repo[]> {
      const per_page = 100;
      const getFromOrg: (o: Object) => Promise<GitHub.Repo[]> =
          promisify(github.repos.getFromOrg);
      let progressLength = 2;
      if (opts.repo.length) {
        progressLength += opts.repo.length;
      }
      const progressBar = standardProgressBar(
          'Discovering repos in PolymerElements...', progressLength);

      // First get the Polymer repo, then get all of the PolymerElements repos.
      const repo: GitHub.Repo =
          await promisify(github.repos.get)({user: 'Polymer', repo: 'polymer'});
      progressBar.tick();
      const repos = [repo];
      if (opts.repo.length) {
        // cleanup passes wants ContributionGuide around
        repos.push(await promisify(github.repos.get)(
            {user: 'PolymerElements', repo: 'ContributionGuide'}));
        progressBar.tick();
        for (let repo of opts.repo) {
          repos.push(await promisify(github.repos.get)(repo));
          progressBar.tick();
        }
      } else {
        let page = 0;
        while (true) {
          const resultsPage =
              await getFromOrg({org: 'PolymerElements', per_page, page});
          repos.push.apply(repos, resultsPage);
          page++;
          if (resultsPage.length < per_page) {
            break;
          }
        }

        // Add in necessary testing repos
        repos.push(await github.getRepoInfo('Polymer', 'polymer-analyzer'));
        // TODO(garlicnation): detect from bower.json
        // TODO(usergenic): Keeping these in comments only until I understand
        // why they were here or recognize they are unnecessary.
        // repos.push(await github.getRepoInfo('PolymerElements',
        // 'iron-image'));
        // repos.push(await github.getRepoInfo('PolymerLabs',
        // 'promise-polyfill'));
        // repos.push(await github.getRepoInfo('webcomponents',
        // 'webcomponentsjs'));
        // repos.push(await github.getRepoInfo('web-animations',
        // 'web-animations-js'));
        // repos.push(await github.getRepoInfo('chjj', 'marked'));
        // repos.push(await github.getRepoInfo('PrismJS', 'prism'));
        progressBar.tick();
      }

      // github pagination is... not entirely consistent, and
      // sometimes gives us duplicate repos.
      const repoIds = new Set<string>();
      const dedupedRepos: GitHub.Repo[] = [];
      for (const repo of repos) {
        if (repoIds.has(repo.name)) {
          continue;
        }
        repoIds.add(repo.name);
        dedupedRepos.push(repo);
      }
      return dedupedRepos;
    }


let elementsPushed = 0;
let pushesDenied = 0;
/**
 * Will return true at most opts.max_changes times. After that it will always
 * return false.
 *
 * Counts how many times both happen.
 * TODO(rictic): this should live in a class rather than as globals.
 */
function pushIsAllowed() {
  if (elementsPushed < opts.max_changes) {
    elementsPushed++;
    return true;
  }
  pushesDenied++;
  return false;
}



/**
 * Analyzes all of the HTML in 'repos/*' with hydrolysis.
 *
 * @returns a promise of the hydrolysis.Analyzer with all of the info loaded.
 */
async function analyzeRepos() {
  const dirs = fs.readdirSync('repos/');
  const htmlFiles: string[] = [];

  for (const dir of dirs) {
    for (const fn of fs.readdirSync(path.join('repos', dir))) {
      if (/index\.html|dependencies\.html/.test(fn) || !fn.endsWith('.html')) {
        continue;
      }
      // We want to ignore files with 'demo' in them, unless the element's
      // directory has the word 'demo' in it, in which case that's
      // the whole point of the element.
      if (!/\bdemo\b/.test(dir) && /demo/.test(fn)) {
        continue;
      }
      htmlFiles.push(path.join('repos', dir, fn));
    }
  }

  function filter(repo: string) {
    return !util.existsSync(repo);
  }

  // This code is conceptually simple, it's only complex due to ordering
  // and the progress bar. Basically we call analyzer.metadataTree on each
  // html file in sequence, then finally call analyzer.annotate() and return.
  const analyzer =
      await hydrolysis.Analyzer.analyze('repos/polymer/polymer.html', {filter});

  const progressBar = new ProgressBar(
      `:msg [:bar] :percent`,
      {total: htmlFiles.length + 1, width: progressBarWidth});

  for (const htmlFile of htmlFiles) {
    await analyzer.metadataTree(htmlFile);
    const msg = pad(
        `Analyzing ${htmlFile.slice(6)}`, progressMessageWidth, {strip: true});
    progressBar.tick({msg});
  }


  progressBar.tick(
      {msg: pad('Analyzing with hydrolysis...', progressMessageWidth)});
  analyzer.annotate();
  return analyzer;
}

async function _main(elements: ElementRepo[]) {
  tattoo.connect();
  tattoo.cloneOrUpdateAllTheRepos();

  const promises: Promise<ElementRepo>[] = [];

  fs.writeFileSync('repos/.bowerrc', JSON.stringify({directory: '.'}));
  const bowerCmd = resolve.sync('bower');
  child_process.execSync(
      `node ${bowerCmd} install web-component-tester`,
      {cwd: 'repos', stdio: 'ignore'});

  const testPromises: Array<Promise<TestResult>> = [];
  let elementsToTest: ElementRepo[];

  if (typeof opts['test-repo'] === 'string') {
    if (opts['test-repo']) {
      opts['test-repo'] = [opts['test-repo']];
    } else {
      opts['test-repo'] = [];
    }
  }
  // 'repos'
  const prefix = 6;
  if (opts['test-repo'].length > 0) {
    elementsToTest = elements.filter((el) => {
      return opts['test-repo'].indexOf(el.dir.substring(prefix)) > -1;
    });
  } else {
    elementsToTest = elements;
  }

  for (const element of elementsToTest) {
    if (excludes.has(element.dir)) {
      continue;
    }
    try {
      const testPromise = testRateLimiter.schedule(() => {
        return test(element, opts['wctflags'].split(' '));
      });
      testPromises.push(testPromise);
    } catch (err) {
      throw new Error(`Error testing ${element.dir}:\n${err.stack || err}`);
    }
  }
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const testResults =
      await util.promiseAllWithProgress(testPromises, 'Testing...');
  // Give the progress bar a chance to display.
  await new Promise((resolve, _) => {
    setTimeout(() => resolve(), 1000);
  });
  let rerun = '#!/bin/bash\n';
  for (let result of testResults) {
    const statusString = (() => {
      switch (result.result) {
        case TestResultValue.passed:
          passed++;
          return 'PASSED';
        case TestResultValue.failed:
          rerun += `pushd ${result.elementRepo.dir}\n`;
          rerun += `wct\n`;
          rerun += `popd\n`;
          failed++;
          return 'FAILED';
        case TestResultValue.skipped:
          skipped++;
          return 'SKIPPED';
      }
    })();
    if (result.result === TestResultValue.failed) {
      console.log(
          'Tests for: ' + result.elementRepo.dir + ' status: ' + statusString);
      if (opts['verbose']) {
        console.log(result.output);
      }
    }
  }
  const total = passed + failed;
  console.log(`${passed} / ${total} tests passed. ${skipped} skipped.`);
  if (failed > 0) {
    fs.writeFileSync('rerun.sh', rerun, {mode: 0o700});
  }
}
