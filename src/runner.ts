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
import * as pad from 'pad';
import * as path from 'path';
import * as promisify from 'promisify-node';
import * as rimraf from 'rimraf';
import * as resolve from 'resolve';

import * as git from './git';
// import {test} from './test';
import {TestResult, TestResultValue} from './test-result';
import * as util from './util';
import {Workspace, WorkspaceRepo} from './workspace';

/**
 * RunnerOptions contains all configuration used when constructing an instance
 * of the Runner.
 */
export interface RunnerOptions {
  // An array of repo expressions for filtering out repos to load.
  excludeRepos?: string[];

  // The github token needed to use the github API.
  githubToken: string;

  // If true, each run will clone new copies of repos instead of updating those
  // already in-place.
  fresh?: boolean;

  // If true, repo clones will be pointed towards last tagged released version
  // instead of the default master branch.  This will not override explicit
  // refs in the  repo expression if present.
  latestRelease?: boolean;

  // An array of repo expressions defining the set of repos to require/load
  // but not specifically to test.
  repos?: string[];

  // An array of repo expressions representing repos to exclude from testing
  // should any matching ones be encountered in the tests array.
  skipTests?: string[];

  // An array of repo expressions defining the set of repos to test with the
  // web-component-tester.  Note that repos in this list do not have to be
  // present in the repos array.
  tests: string[];

  // If true, output will information used primarily for debug purposes.
  verbose?: boolean;

  // Command-line flags to send to web-component-tester.
  wctFlags?: string[];

  // The folder to clone repositories into and run tests from.  Defaults to
  // './repos' if not provided.
  workspaceDir?: string;
}

export class Runner {
  // The repository patterns we do not want to load.
  private _excludeRepos: string[];

  // Always clone a fresh copy of the repository (don't just update existing
  // clone.)
  private _fresh: boolean;

  private _github?: git.GitHubConnection;
  private _repos: string[];
  private _skipTests: string[];
  private _tests: string[];
  private _testRateLimiter: Bottleneck;
  private _verbose: boolean;
  private _wctFlags: string;
  private _workspace: Workspace;

  // TODO(usergenic): This constructor is getting long.  Break up some of
  // these stanzas into supporting methods.
  constructor(options: RunnerOptions) {
    this._excludeRepos = options.excludeRepos || [];
    this._fresh = !!options.fresh;
    // TODO(usergenic): Pass an option to gitUtil.connectToGitHub for the
    // rate limiter it uses.
    this._github = new git.GitHubConnection(options.githubToken);
    this._repos = options.repos || [];
    this._skipTests = options.skipTests || [];
    this._tests = options.tests || [];
    this._verbose = !!options.verbose;
    this._wctFlags = options.wctFlags ? options.wctFlags.join(' ') : '';
    this._workspace = {dir: (options.workspaceDir || './repos'), repos: {}};

    // TODO(usergenic): Rate limit should be an option.
    this._testRateLimiter = new Bottleneck(1, 100);

    if (this._verbose) {
      console.log('Tattoo Runner configuration:');
      console.log({
        excludeRepos: this._excludeRepos,
        fresh: this._fresh,
        repos: this._repos,
        skipTests: this._skipTests,
        tests: this._tests,
        wctFlags: this._wctFlags,
        workspaceDir: this._workspace.dir
      });
    }
  }

  /**
   * Given all the repos defined in the workspace, lets iterate through them
   * and either clone them or update their clones and set them to the specific
   * refs.
   */
  async _cloneOrUpdateWorkspaceRepos() {
    const promises: Promise<nodegit.Repository>[] = [];

    // Clone git repos.
    for (const name in this._workspace.repos) {
      const repo = this._workspace.repos[name];
      promises.push(
          this._github
              .clone(repo.githubRepo, path.join(this._workspace.dir, repo.dir))
              .then(
                  (nodegitRepo) => git.checkout(
                      nodegitRepo, repo.githubRepoRef.checkoutRef)));
    }

    // TODO(usergenic): We probably want to track the set of repos completed so
    // we can identify the problem repos in case error messages come back
    // without enough context for users to debug.
    await util.promiseAllWithProgress(promises, 'Cloning repos...');
  }

  async _determineWorkspaceRepos() {
    let allGitHubRepoRefs: git.GitHubRepoRef[] = [];

    // This is an index of names of owned repos so we can download the set
    // just once for each owner, in the event we have wildcard in more than
    // one repo config.
    const reposByOwner: {[owner: string]: string[]} = {};

    // Add every explicit repo and every repo from expanding wildcard names.
    for (const githubRepoRef of this._repos.map(git.parseGitHubRepoRefString)) {
      // If the repo has no wildcard, lets just put it in the list of all repos.
      if (!githubRepoRef.repoName.match('*')) {
        allGitHubRepoRefs.push(githubRepoRef);
      } else {
        // If we have not downloaded the repo names for this owner before, lets
        // do that.
        if (!reposByOwner[githubRepoRef.ownerName]) {
          reposByOwner[githubRepoRef.ownerName] =
              await this._github.getRepoNames(githubRepoRef.ownerName);
        }

        const repoNameRegExp = util.wildcardRegExp(githubRepoRef.repoName);

        // Loop through all the names of the repos for the owner and add
        // RepoConfigs to the allRepos list for every matching one.
        allGitHubRepoRefs.push.apply(
            allGitHubRepoRefs,
            reposByOwner[githubRepoRef.ownerName]
                .filter(name => repoNameRegExp.test(name))
                .map(name => ({
                       ownerName: githubRepoRef.ownerName,
                       checkoutRef: githubRepoRef.checkoutRef,
                       repoName: name
                     })));
      }
    }

    // TODO(usergenic): Maybe we should be obtaining the package name here
    // from the repository's bower.json or package.json.

    for (const exclude of this._excludeRepos) {
      const excludeRepoRef = git.parseGitHubRepoRefString(exclude);
      const excludeOwnerRegExp = util.wildcardRegExp(excludeRepoRef.ownerName);
      const excludeRepoRegExp = util.wildcardRegExp(excludeRepoRef.repoName);
      const excludeCheckoutRegExp = excludeRepoRef.checkoutRef ?
          util.wildcardRegExp(excludeRepoRef.checkoutRef) :
          undefined;

      allGitHubRepoRefs = allGitHubRepoRefs.filter((repo) => {
        if (!excludeOwnerRegExp.test(repo.ownerName) ||
            !excludeRepoRegExp.test(repo.repoName)) {
          return false;
        }
        if (typeof excludeCheckoutRegExp !== 'undefined') {
          return typeof repo.checkoutRef !== 'undefined' &&
              excludeCheckoutRegExp.test(repo.checkoutRef);
        }
        return true;
      });
    }

    // NOTE(usergenic): We might need this here.  The old repo list included
    // hydrolysis:
    // allRepos.push(gitUtil.parseRepoExpression('Polymer/polymer-analyzer'));

    // Build the map of repos by name
    for (const repoRef of allGitHubRepoRefs) {
      // TODO(usergenic): This error is a bit strict and also doesn't reveal
      // enough data to help troubleshoot.  I.e. what is the full config of
      // the existing repo.  Update this message.
      if (this._workspace.repos[repoRef.repoName]) {
        throw(`More than repo with name '${repoRef.repoName}' defined.`);
      }

      this._workspace.repos[repoRef.repoName] = {
        githubRepoRef: repoRef,
        dir: repoRef.repoName
      };
    }
  }

  /**
   * Cleans up the workspace folder and fixes repos which may be in incomplete
   * or bad state due to prior abended runs.
   */
  async _prepareWorkspaceFolder() {
    const workspaceDir = this._workspace.dir;

    // Clean up repos when 'fresh' option is true.
    if (this._fresh) {
      await promisify(rimraf)(workspaceDir);
    }

    // Ensure repos folder exists.
    if (!util.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir);
    }

    // Sometimes a repo will be left in a bad state. Deleting it here
    // will let it get cleaned up later.
    for (let dir of fs.readdirSync(workspaceDir)) {
      const repoDir = path.join(workspaceDir, dir);
      if (!util.isDirSync(repoDir) || fs.readdirSync(repoDir).length === 1) {
        await promisify(rimraf)(repoDir);
      }
    }
  }

  /**
   * All repos specified by tests option will be run through wct.
   */
  async _testAllTheThings(): Promise<TestResult[]> {
    return [];
  }

  async _reportTestResults(testResults: TestResult[]) {
  }

  /**
   * Works through the sequence of operation, steps in the sequence are
   * encapsulated for clarity but each typically have side-effects on file
   * system or on workspace.
   * TODO(usergenic): Support a --dry-run option.
   */
  async run() {
    // Workspace repo map is empty until we determine what they are.
    await this._determineWorkspaceRepos();
    // Clean up the workspace folder and prepare it for repo clones.
    await this._prepareWorkspaceFolder();
    // Update in-place and/or clone repositories from GitHub.
    await this._cloneOrUpdateWorkspaceRepos();
    // Run all the tests.
    const testResults = await this._testAllTheThings();
    // Report test results.
    this._reportTestResults(testResults);
  }
}


/**
 * Returns a Promise of a list of Polymer github repos to automatically
 * cleanup / transform.
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
**/

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

  const progressBar =
      util.standardProgressBar('Analyzing...', htmlFiles.length + 1);

  for (const htmlFile of htmlFiles) {
    await analyzer.metadataTree(htmlFile);
    progressBar.tick(
        {msg: util.progressMessage(`Analyzing ${htmlFile.slice(6)}`)});
  }

  progressBar.tick({msg: util.progressMessage('Analyzing with hydrolysis...')});
  analyzer.annotate();
  return analyzer;
}

/**
async function _main(elements: ElementRepo[]) {
  runner.connect();
  runner.cloneOrUpdateAllTheRepos();

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
**/
