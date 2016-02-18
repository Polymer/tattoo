#!/usr/bin/env node --harmony
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

"use strict";

declare function require(name: string): any;
try {
  require("source-map-support").install();
} catch (err) {

}

import * as cliArgs from "command-line-args";
import * as fs from "fs";
import * as GitHub from "github";
import * as hydrolysis from "hydrolysis";
import * as nodegit from "nodegit";
import * as pad from "pad";
import * as path from "path";
import * as ProgressBar from "progress";
import * as promisify from "promisify-node";
import * as rimraf from "rimraf";
import * as Bottleneck from "bottleneck";
import * as child_process from "child_process";

import {ElementRepo, PushStatus} from "./element-repo";
import * as util from "./util";
import {TestResult, TestResultValue} from "./test-result";
import {test} from "./test";

const cli = cliArgs([
  {name: "help", type: Boolean, alias: "h", description: "Print usage."},
  {
    name: "repo",
    type: (s: string) => {
      if (!s) {
        throw new Error("Value expected for --repo|-r flag");
      }
      let parts = s.split("/");
      if (parts.length !== 2) {
        throw new Error(`Given repo ${s} is not in form user/repo`);
      }
      return {user: parts[0], repo: parts[1]};
    },
    defaultValue: [],
    multiple: true,
    alias: "r",
    description:
        "Explicit repos to process. Specifying explicit repos will disable" +
        "running on the implicit set of repos for the user."
  },
  {
    name: "clean",
    type: Boolean,
    defaultValue: false,
    description:
        "Set to clone all repos from remote instead of updating local copies."
  },
  {
    name: "verbose",
    type: Boolean,
    defaultValue: false,
    description:
        "Set to print output from failed tests."
  }
]);

console.time("tattoo");

interface UserRepo {
  user: string;
  repo: string;
}
interface Options {
  help: boolean;
  max_changes: number;
  repo: UserRepo[];
  pass: string[];
}
const opts: Options = cli.parse();

const cloneRateLimiter = new Bottleneck(20, 100);
const testRateLimiter = new Bottleneck(1, 100);

if (opts.help) {
  console.log(cli.getUsage({
    header: "tattoo runs many tests at various branches!!",
    title: "tattoo"
  }));
  process.exit(0);
}

let GITHUB_TOKEN: string;

try {
  GITHUB_TOKEN = fs.readFileSync("token", "utf8").trim();
} catch (e) {
  console.error(`
You need to create a github token and place it in a file named 'token'.
The token only needs the 'public repos' permission.

Generate a token here:   https://github.com/settings/tokens
`);
  process.exit(1);
}



const github = connectToGithub();

const progressMessageWidth = 40;
const progressBarWidth = 45;

function getRepo(user: string, repo: string): Promise<GitHub.Repo> {
  return promisify(github.repos.get)({
    user: user,
    repo: repo
  });
}

/**
 * Returns a Promise of a list of Polymer github repos to automatically
 * cleanup / transform.
 */
async function getRepos(): Promise<GitHub.Repo[]> {
  const per_page = 100;
  const getFromOrg: (o: Object) => Promise<GitHub.Repo[]> =
      promisify(github.repos.getFromOrg);
  let progressLength = 2;
  if (opts.repo.length) {
    progressLength += opts.repo.length;
  }
  const progressBar = standardProgressBar(
      "Discovering repos in PolymerElements...", progressLength);

  // First get the Polymer repo, then get all of the PolymerElements repos.
  const repo: GitHub.Repo =
      await promisify(github.repos.get)({user: "Polymer", repo: "polymer"});
  progressBar.tick();
  const repos = [repo];
  if (opts.repo.length) {
    // cleanup passes wants ContributionGuide around
    repos.push(
        await promisify(github.repos.get)(
            {user: "PolymerElements", repo: "ContributionGuide"}));
    progressBar.tick();
    for (let repo of opts.repo) {
      repos.push(await promisify(github.repos.get)(repo));
      progressBar.tick();
    }
  } else {
    let page = 0;
    while (true) {
      const resultsPage =
          await getFromOrg({org: "PolymerElements", per_page, page});
      repos.push.apply(repos, resultsPage);
      page++;
      if (resultsPage.length < per_page) {
        break;
      }
    }

    // Add in necessary testing repos
    // TODO(garlicnation): detect from bower.json
    repos.push(await getRepo("Polymer", "hydrolysis"));
    repos.push(await getRepo("PolymerElements", "iron-image"));
    repos.push(await getRepo("PolymerLabs", "promise-polyfill"));
    repos.push(await getRepo("webcomponents", "webcomponentsjs"));
    repos.push(await getRepo("web-animations", "web-animations-js"));
    repos.push(await getRepo("chaijs", "chai"));
    repos.push(await getRepo("sinonjs", "sinon"));
    repos.push(await getRepo("mochajs", "mocha"));
    repos.push(await getRepo("chjj", "marked"));
    repos.push(await getRepo("PrismJS", "prism"));
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

/**
 * Like Promise.all, but also displays a progress bar that fills as the
 * promises resolve. The label is a helpful string describing the operation
 * that the user is waiting on.
 */
function promiseAllWithProgress<T>(
    promises: Promise<T>[], label: string): Promise<T[]> {
  const progressBar = standardProgressBar(label, promises.length);
  const progressed: Promise<T>[] = [];
  for (const promise of promises) {
    let res: T;
    progressed.push(Promise.resolve(promise)
        .then((resolution) => {
          res = resolution;
          return progressBar.tick();
        }).then(() => res));
  }
  return Promise.all(progressed);
}

function standardProgressBar(label: string, total: number) {
  const pb = new ProgressBar(
      `${pad(label, progressMessageWidth)} [:bar] :percent`,
      {total, width: progressBarWidth}
    );
  // force the progress bar to start at 0%
  pb.render();
  return pb;
}

/**
 * Creates a branch with the given name on the given repo.
 *
 * returns a promise of the nodegit Branch object for the new branch.
 */
async function checkoutNewBranch(
    repo: nodegit.Repository, branchName: string): Promise<void> {
  const commit = await repo.getHeadCommit();
  const branch =
      await nodegit.Branch.create(repo, branchName, commit, false);
  return repo.checkoutBranch(branch);
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
 * Returns an authenticated github connection.
 */
function connectToGithub() {
  const github = new GitHub({
    version: "3.0.0",
    protocol: "https",
  });

  github.authenticate({type: "oauth", token: GITHUB_TOKEN});
  return github;
}


/**
 * Analyzes all of the HTML in 'repos/*' with hydrolysis.
 *
 * Returns a promise of the hydrolysis.Analyzer with all of the info loaded.
 */
async function analyzeRepos() {
  const dirs = fs.readdirSync("repos/");
  const htmlFiles: string[] = [];

  for (const dir of dirs) {
    for (const fn of fs.readdirSync(path.join("repos", dir))) {
      if (/index\.html|dependencies\.html/.test(fn) || !fn.endsWith(".html")) {
        continue;
      }
      // We want to ignore files with 'demo' in them, unless the element's
      // directory has the word 'demo' in it, in which case that's
      // the whole point of the element.
      if (!/\bdemo\b/.test(dir) && /demo/.test(fn)) {
        continue;
      }
      htmlFiles.push(path.join("repos", dir, fn));
    }
  }

  function filter(repo: string) { return !util.existsSync(repo); }

  // This code is conceptually simple, it's only complex due to ordering
  // and the progress bar. Basically we call analyzer.metadataTree on each
  // html file in sequence, then finally call analyzer.annotate() and return.
  const analyzer =
      await hydrolysis.Analyzer.analyze("repos/polymer/polymer.html", {filter});

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
      {msg: pad("Analyzing with hydrolysis...", progressMessageWidth)});
  analyzer.annotate();
  return analyzer;
}

function openRepo(cloneOptions: nodegit.CloneOptions, ghRepo: GitHub.Repo) {
  const dir = path.join("repos", ghRepo.name);
  let repoPromise: Promise<nodegit.Repository>;
  if (util.existsSync(dir)) {
    let updatedRepo: nodegit.Repository;
    repoPromise = nodegit.Repository.open(dir).then((repo) => {
        updatedRepo = repo;
        return cloneRateLimiter.schedule(() =>
          updatedRepo.fetchAll(cloneOptions.fetchOpts)
        );
      }
    ).then(() => updatedRepo);
  } else {
    repoPromise = cloneRateLimiter.schedule(() => {
      return nodegit.Clone.clone(
        ghRepo.clone_url,
        dir,
        cloneOptions);
    });
  }
  return repoPromise.then((repo) =>
    new ElementRepo({repo, dir, ghRepo, analyzer: null})
  );
}

async function _main(elements: ElementRepo[]) {
  if (opts["clean"]) {
    await promisify(rimraf)("repos");
  }
  if (!util.existsSync("repos")) {
     fs.mkdirSync("repos");
  }

  for (let dir of fs.readdirSync("repos")) {
    const repoDir = path.join("repos", dir);
    // Sometimes a repo will be left in a bad state. Deleting it here
    // will let it get cleaned up later.
    if (!util.isDirSync(repoDir) || fs.readdirSync(repoDir).length === 1) {
      await promisify(rimraf)(repoDir);
    }
  }

  const user = await promisify(github.user.get)({});
  const ghRepos = await getRepos();

  const promises: Promise<ElementRepo>[] = [];

  let cloneOptions: nodegit.CloneOptions = {
    fetchOpts : {
      callbacks: {
        certificateCheck: function() { return 1; },
        credentials: function(url: string, userName: string) {
          return nodegit.Cred.userpassPlaintextNew(GITHUB_TOKEN, "x-oauth-basic");
        }
      }
    }
  };
  // Clone git repos.
  for (const ghRepo of ghRepos) {
    let repoPromise = openRepo(cloneOptions, ghRepo);
    // TODO(garlicnation): Checkout branch of a repository.
    promises.push(repoPromise);
  }
  elements.push(...await promiseAllWithProgress(promises, "Cloning repos..."));

  fs.writeFileSync("repos/.bowerrc", JSON.stringify({directory: "."}));
  child_process.execSync("bower install sinonjs", {cwd: "repos"});

  // Transform code on disk and push it up to github
  // (if that's what the user wants)
  const cleanupPromises: Promise<any>[] = [];
  // All failing tests, or repos with a test/ dir that cause wct to hang.
  const excludes = new Set([
    "repos/style-guide",
    "repos/test-all",
    "repos/ContributionGuide",
    "repos/molecules", // Was deleted
    "repos/polymer",
    "repos/iron-doc-viewer",
    "repos/iron-component-page",
    "repos/platinum-push-messaging",
    "repos/paper-scroll-header-panel",
    "repos/platinum-sw",
    "repos/paper-card",
    "repos/iron-a11y-keys",
    "repos/paper-text-field",
    "repos/iron-swipeable-container",
    "repos/web-animations-js",
    "repos/chai",
    "repos/sinon",
    "repos/hydrolysis",
    "repos/mocha",
    "repos/marked"
  ]);
  const testProgress =
      standardProgressBar("Testing...", elements.length);
  const testPromises: Array<Promise<TestResult>> = [];
  for (const element of elements) {
    if (excludes.has(element.dir)) {
      testProgress.tick();
      continue;
    }
    try {
      const testPromise = testRateLimiter.schedule(() => {
        return test(element);
      });
      testPromises.push(testPromise);
    } catch (err) {
      throw new Error(
          `Error testing ${element.dir}:\n${err.stack || err}`);
    }
  }
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const testResults = await promiseAllWithProgress(testPromises, "Testing...");
  // Give the progress bar a chance to display.
  await new Promise((resolve, _) => {
    setTimeout(() => resolve(), 1000);
  });
  let rerun = "#!/bin/bash\n";
  for (let result of testResults) {
    testProgress.tick();
    const statusString = (() => {
      switch (result.result) {
        case TestResultValue.passed:
          passed++;
          return "PASSED";
        case TestResultValue.failed:
          rerun += `pushd ${result.elementRepo.dir}\n`;
          rerun += `wct\n`;
          rerun += `popd\n`;
          failed++;
          return "FAILED";
        case TestResultValue.skipped:
          skipped++;
          return "SKIPPED";
      }
    })();
    if (result.result === TestResultValue.failed) {
      console.log("Tests for: " + result.elementRepo.dir + " status: " +
                  statusString);
      if (opts["verbose"]) {
        console.log(result.output);
      }
    }
  }
  const total = passed + failed;
  console.log(`${passed} / ${total} tests passed. ${skipped} skipped.`);
  if (failed > 0) {
    fs.writeFileSync("rerun.sh", rerun, {mode: 0o700});
  }
}

async function main() {
  // We do this weird thing, where we pass in an empty array and have the
  // actual _main() add elements to it just so that we can report on
  // what elements did and didn't get pushed even in the case of an error
  // midway through.
  const elements: ElementRepo[] = [];
  try {
    await _main(elements);
  } catch (err) {

    // Report the error and crash.
    console.error("\n\n");
    console.error(err.stack || err);
    process.exit(1);
  }
  console.timeEnd("tattoo");
}

main();
