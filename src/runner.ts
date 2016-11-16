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
import {test} from './test';
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
    this._workspace = {
      dir: (options.workspaceDir || './repos'),
      repos: new Map()
    };

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
 * Analyzes all of the HTML in 'repos/*' with hydrolysis.
 *
 * @returns a promise of the hydrolysis.Analyzer with all of the info loaded.
 */
  async _analyzeRepos() {
    const dirs = fs.readdirSync(this._workspace.dir);
    const htmlFiles: string[] = [];

    for (const dir of dirs) {
      for (const fn of fs.readdirSync(path.join('repos', dir))) {
        if (/index\.html|dependencies\.html/.test(fn) ||
            !fn.endsWith('.html')) {
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
    const analyzer = await hydrolysis.Analyzer.analyze(
        path.join(this._workspace.dir, 'polymer', 'polymer.html'), {filter});

    const progressBar =
        util.standardProgressBar('Analyzing...', htmlFiles.length + 1);

    for (const htmlFile of htmlFiles) {
      await analyzer.metadataTree(htmlFile);
      progressBar.tick(
          {msg: util.progressMessage(`Analyzing ${htmlFile.slice(6)}`)});
    }

    progressBar.tick(
        {msg: util.progressMessage('Analyzing with hydrolysis...')});
    analyzer.annotate();
    return analyzer;
  }

  /**
   * Given all the repos defined in the workspace, lets iterate through them
   * and either clone them or update their clones and set them to the specific
   * refs.
   */
  async _cloneOrUpdateWorkspaceRepos() {
    if (this._verbose) {
      console.log('Cloning/updating workspace repos...');
    }

    const promises: Promise<nodegit.Repository>[] = [];

    // Clone git repos.
    for (const name of this._workspace.repos.keys()) {
      const repo = this._workspace.repos.get(name);
      if (util.isDirSync(repo.dir)) {
        repo.nodegitRepo = await nodegit.Repository.open(
            path.join(this._workspace.dir, repo.dir));
        promises.push(this._github.update(repo.nodegitRepo));
      }
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
    await util.promiseAllWithProgress(promises, 'Cloning/Updating repos...');
  }

  /**
   * Given the arrays of repos and tests, expand the set (where wildcards are
   * employed) and then reduce the set with excludeRepos, and set the workspace
   * repos appropriately.
   * TODO(usergenic): This method is getting long.  Break it up into sub-methods
   * perhaps one for expanding the set of repos by going to github etc and
   * another to remove items.
   * TODO(usergenic): Should this method explode if it results in no repos to
   * test?
   */
  async _determineWorkspaceRepos() {
    if (this._verbose) {
      console.log('Determining workspace repos...');
    }
    // Expand all repos and filter out the excluded repos
    const expandedRepos: git.GitHubRepoRef[] =
        (await this._expandWildcardRepoRefs(
             this._repos.map(git.parseGitHubRepoRefString)))
            .filter(
                repo => !this._excludeRepos.some(
                    exclude => git.matchRepoRef(
                        git.parseGitHubRepoRefString(exclude), repo)));

    // Expand all tests and filter out the skipped tests
    const expandedTests: git.GitHubRepoRef[] =
        (await this._expandWildcardRepoRefs(
             this._tests.map(git.parseGitHubRepoRefString)))
            .filter(
                test => !this._skipTests.some(
                    skip => git.matchRepoRef(
                        git.parseGitHubRepoRefString(skip), test)));

    // TODO(usergenic): Maybe we should be obtaining the package name here
    // from the repository's bower.json or package.json.

    // NOTE(usergenic): We might need this here.  The old repo list included
    // hydrolysis:
    // allRepos.push(gitUtil.parseRepoExpression('Polymer/polymer-analyzer'));

    // Need to download all the GitHub.Repo representations for these.
    const githubRepoRefs: git.GitHubRepoRef[] =
        expandedRepos.concat(expandedTests);

    const githubRepos: GitHub.Repo[] = await util.promiseAllWithProgress(
        githubRepoRefs.map(
            repo => this._github.getRepoInfo(repo.ownerName, repo.repoName)),
        'Getting Repo details from GitHub...');

    // Build the map of repos by name
    for (const repoRef of githubRepoRefs) {
      // TODO(usergenic): This error is a bit strict and also doesn't reveal
      // enough data to help troubleshoot.  I.e. what is the full config of
      // the existing repo.  Update this message.
      if (this._workspace.repos[repoRef.repoName]) {
        throw(`More than repo with name '${repoRef.repoName}' defined.`);
      }

      this._workspace.repos.set(repoRef.repoName, {
        githubRepoRef: repoRef,
        dir: repoRef.repoName,
        test: expandedTests.some(test => git.matchRepoRef(test, repoRef)),
        githubRepo: githubRepos.find(
            githubRepo => git.matchRepoRef(
                git.parseGitHubRepoRefString(githubRepo.full_name), repoRef))
      });
    }

    if (this._verbose) {
      const workspaceReposToTest =
          Array.from(this._workspace.repos.entries())
              .filter(repo => repo[1].test)
              .sort((a, b) => a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0));
      console.log(`Repos to test: ${workspaceReposToTest.length}`);
      for (const repo of workspaceReposToTest) {
        console.log(`    ${git.serializeGitHubRepoRef(repo[1].githubRepoRef)}`);
      }
      const workspaceReposToRequire =
          Array.from(this._workspace.repos.entries())
              .filter(repo => !repo[1].test)
              .sort((a, b) => a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0));
      if (workspaceReposToRequire.length > 0) {
        console.log(`Repos to provide, but not test: ${workspaceReposToRequire
                        .length}`);
        for (const repo of workspaceReposToRequire) {
          console.log(
              `   ${git.serializeGitHubRepoRef(repo[1].githubRepoRef)}`);
        }
      }
    }
  }

  /**
   * Given a collection of GitHubRepoRefs, replace any that represent wildcard
   * values with the literal values after comparing against names of repos on
   * GitHub.  So a repo ref like `Polymer/*` return everything owned by
   * Polymer where `PolymerElements/iron-*` would be all repos that start with
   * `iron-` owned by `PolymerElements` org.
   */
  async _expandWildcardRepoRefs(repoRefs: git.GitHubRepoRef[]):
      Promise<git.GitHubRepoRef[]> {
    const ownersToFetchRepoNamesFor: Set<string> = new Set();
    for (const repo of repoRefs) {
      if (repo.repoName.match(/\*/)) {
        ownersToFetchRepoNamesFor.add(repo.ownerName.toLowerCase());
      }
    }
    if (ownersToFetchRepoNamesFor.size === 0) {
      return Array.from(repoRefs);
    }

    // TODO(usergenic): When there are repos and tests with wildcards, we
    // get two progress bars, identically labeled.  We should move the work to
    // fetch the pages of repos into a support method that can be called in
    // advance of the expand call and put the progress bar message there.
    const allGitHubRepoRefs: git.GitHubRepoRef[] =
        (await util.promiseAllWithProgress(
             Array.from(ownersToFetchRepoNamesFor)
                 .map(owner => this._github.getRepoFullNames(owner)),
             'Fetching repo names for wildcard search'))
            .reduce((a, b) => a.concat(b))
            .map(git.parseGitHubRepoRefString);
    const expandedRepoRefs: git.GitHubRepoRef[] = [];
    for (const repoRef of repoRefs) {
      if (repoRef.repoName.match(/\*/)) {
        expandedRepoRefs.push.apply(
            expandedRepoRefs,
            allGitHubRepoRefs.filter(
                otherRepoRef => git.matchRepoRef(repoRef, otherRepoRef)));
      } else {
        expandedRepoRefs.push(repoRef);
      }
    }
    return expandedRepoRefs;
  }

  /**
   * Cleans up the workspace folder and fixes repos which may be in
   * incomplete
   * or bad state due to prior abended runs.
   */
  async _prepareWorkspaceFolder() {
    const workspaceDir = this._workspace.dir;

    if (this._verbose) {
      console.log(`Preparing workspace folder ${workspaceDir}...`);
    }
    // Clean up repos when 'fresh' option is true.
    if (this._fresh) {
      if (this._verbose) {
        console.log(`Removing workspace folder ${workspaceDir}...`);
      }
      await promisify(rimraf)(workspaceDir);
    }

    // Ensure repos folder exists.
    if (!util.existsSync(workspaceDir)) {
      if (this._verbose) {
        console.log(`Creating workspace folder ${workspaceDir}...`);
      }
      fs.mkdirSync(workspaceDir);
    }

    // Sometimes a repo will be left in a bad state. Deleting it here
    // will let it get cleaned up later.
    for (let dir of fs.readdirSync(workspaceDir)) {
      const repoDir = path.join(workspaceDir, dir);
      if (!util.isDirSync(repoDir) || fs.readdirSync(repoDir).length === 1) {
        if (this._verbose) {
          console.log(`Removing clone ${repoDir}...`);
        }
        await promisify(rimraf)(repoDir);
      }
    }
  }

  /**
   * @returns a dictionary object of dev dependencies from the bower.json
   * entries in all workspace repos that are marked for test, suitable for
   * serializing into the devDependencies key of a generated bower.json file
   * for the workspace dir.
   *
   * TODO(usergenic): Merge strategy blindly overwrites previous value for key with whatever new value it encounters as we iterate through bower configs
   * which may not be what we want.  Preserving the
   * highest semver value is *probably* the desired approach
   * instead.
   */
  _mergedTestRepoBowerConfig(): {
    name: string; dependencies: {[key: string]: string};
    resolutions: {[key: string]: string};
  } {
    const merged = {
      name: 'generated-bower-config-for-tattoo-workspace',
      dependencies: {},
      resolutions: {}
    };
    for (const repo of Array.from(this._workspace.repos.values())
             .filter(repo => repo.test)) {
      const repoPath = path.join(this._workspace.dir, repo.dir);
      // TODO(usergenic): Verify that we can assume bower.json is the config
      // file in the event any repo-specific .bowerrc files are capable of
      // redefining its name.
      const bowerJsonPath = path.join(repoPath, 'bower.json');
      if (!util.existsSync(bowerJsonPath)) {
        continue;
      }
      let bowerJson = fs.readFileSync(bowerJsonPath).toString();
      let bowerConfig = JSON.parse(bowerJson);
      if (bowerConfig.devDependencies) {
        for (const name in bowerConfig.devDependencies) {
          merged.dependencies[name] = bowerConfig.devDependencies[name];
        }
      }
      if (bowerConfig.dependencies) {
        for (const name in bowerConfig.dependencies) {
          merged.dependencies[name] = bowerConfig.dependencies[name];
        }
      }
      if (bowerConfig.resolutions) {
        for (const name in bowerConfig.resolutions) {
          merged.resolutions[name] = bowerConfig.resolutions[name];
        }
      }
    }
    return merged;
  }

  /**
   * Creates a .bowerrc that tells bower to use the workspace dir (`.`) as
   * the installation dir (instead of default (`./bower_components`) dir.
   * Creates a bower.json which sets all the workspace repos as dependencies
   * and
   * also includes the devDependencies from all workspace repos under test.
   */
  _installWorkspaceDependencies() {
    const pb =
        util.standardProgressBar('Installing dependencies with bower...', 1);

    fs.writeFileSync(
        path.join(this._workspace.dir, '.bowerrc'),
        JSON.stringify({directory: '.'}));

    const bowerConfig = this._mergedTestRepoBowerConfig();

    // TODO(usergenic): Verify this is even needed.
    if (!bowerConfig.dependencies['web-component-tester']) {
      bowerConfig.dependencies['web-component-tester'] = '';
    }

    // Make bower config point bower packages of workspace repos to themselves
    // to override whatever any direct or transitive dependencies say.
    for (const repo of Array.from(this._workspace.repos.entries())) {
      bowerConfig.dependencies[repo[0]] = `./${repo[1].dir}`;
    }

    fs.writeFileSync(
        path.join(this._workspace.dir, 'bower.json'),
        JSON.stringify(bowerConfig));

    // TODO(usergenic): Can we switch to using bower as library here?  Might
    // even give us better option for progress bar.
    // HACK(usergenic): Need a reliable way to obtain the bower bin script.
    const bowerCmd = path.join(resolve.sync('bower'), '../bin/bower.js');
    child_process.execSync(`node ${bowerCmd} install -F`, {
      // node ${bowerCmd} install`, {
      cwd: this._workspace.dir,
      stdio: (this._verbose ? 'inherit' : 'ignore')
    });
    pb.tick();
  }

  /**
   * All repos specified by tests option will be run through wct.
   */
  async _testAllTheThings(): Promise<TestResult[]> {
    if (this._verbose) {
      console.log('Test all the things...');
    }

    const testPromises: Promise<TestResult>[] = [];

    for (const repo of Array.from(this._workspace.repos.values())
             .filter(repo => repo.test)) {
      try {
        const testPromise = this._testRateLimiter.schedule(() => {
          return test(this._workspace, repo, this._wctFlags.split(' '));
        });
        testPromises.push(testPromise);
      } catch (err) {
        throw new Error(`Error testing ${repo.dir}:\n${err.stack || err}`);
      }
    }
    return await util.promiseAllWithProgress(testPromises, 'Testing...');
  }

  async _reportTestResults(testResults: TestResult[]) {
    if (this._verbose) {
      console.log('Report test results...');
    }

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let rerun = '#!/bin/bash\n';
    for (let result of testResults) {
      const statusString = (() => {
        switch (result.result) {
          case TestResultValue.passed:
            passed++;
            return 'PASSED';
          case TestResultValue.failed:
            rerun += `pushd ${result.workspaceRepo.dir}\n`;
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
            'Tests for: ' + result.workspaceRepo.dir + ' status: ' +
            statusString);
        if (this._verbose) {
          console.log(result.output);
        }
      }
    }
    const total = passed + failed;
    console.log(`${passed} / ${total} tests passed. ${skipped} skipped.`);
    if (failed > 0) {
      fs.writeFileSync('rerun.sh', rerun, {mode: 0o700});
    }

    return testResults;
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
    // Bower installs all the devDependencies of test repos also gets wct.
    this._installWorkspaceDependencies();
    // Run all the tests.
    const testResults = await this._testAllTheThings();
    // Report test results.
    this._reportTestResults(testResults);
  }
}
