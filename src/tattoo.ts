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
import * as resolve from "resolve";

import {ElementRepo, PushStatus} from "./element-repo";
import * as util from "./util";
import {TestResult, TestResultValue} from "./test-result";
import {test} from "./test";
import {checkoutLatestRelease} from "./latest-release";

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
        "Explicit repos to load. Specifying explicit repos will disable" +
        "running on the default set of repos for the user."
  }, {
    name: "test-repo",
    type: String,
    defaultValue: [],
    multiple: true,
    alias: "t",
    description:
        "Repositories to test. All dependencies must be specified with --repo" +
        " or be included in the default set."
  },
  {
    name: "clean",
    type: Boolean,
    defaultValue: false,
    description:
        "Set to clone all repos from remote instead of updating local copies."
  },
  {
    name: "wctflags",
    type: String,
    defaultValue: "-b chrome",
    description: "Set to specify flags passed to wct."
  },
  {
    name: "released",
    type: Boolean,
    defaultValue: false,
    description:
        "Set to update repos to the latest release when possible."
  },
  {
    name: "configfile",
    alias: "c",
    type: String,
    defaultValue: "tattoo_config.json",
    description:
        "Set to use a config file to override branches/orgs for particular repos."
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

interface RepoConfig {
  org?: string;
  repo?: string;
  ref?: string;
}

interface BranchConfig {
  [key: string]: RepoConfig;
}

interface SerializedBranchConfig {
  [key: string]: string;
}

interface TattooConfig {
  branchconfig?: SerializedBranchConfig;
  wctflags?: Array<string>;
}

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

function isRedirect(repo: GitHub.Repo): boolean {
  return !!(repo['meta'] && repo['meta']['status'].match(/^301\b/));
}

function getRepo(user: string, repo: string): Promise<GitHub.Repo> {
  return promisify(github.repos.get)({
    user: user,
    repo: repo
  }).then((response) => {
    // TODO(usergenic): Patch to _handle_ redirects and/or include
    // details in error messaging.  This was encountered because we
    // tried to request Polymer/hydrolysis which has been renamed to
    // Polymer/polymer-analyzer.
    if (isRedirect(response)) {
      console.log('Repo ${user}/${repo} has moved permanently.');
      console.log(response);
      throw(`Repo ${user}/${repo} could not be loaded.`);
    }
    return response;
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
    repos.push(await getRepo("Polymer", "polymer-analyzer"));
    repos.push(await getRepo("PolymerElements", "iron-image"));
    repos.push(await getRepo("PolymerLabs", "promise-polyfill"));
    repos.push(await getRepo("webcomponents", "webcomponentsjs"));
    repos.push(await getRepo("web-animations", "web-animations-js"));
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
 * Checks out a branch with a given name on a repo.
 *
 * returns a promise of the nodegit Branch object for the new branch.
 */
async function checkoutBranch(
    repo: nodegit.Repository, branchName: string): Promise<nodegit.Repository> {
    return new Promise<nodegit.Repository>((resolve, reject) => (
      child_process.exec("git checkout " + branchName,
          {cwd: repo.workdir()},
          (error, stdout, stderr)  => {
            if (error) {
              console.log("Error checkout out " + branchName + "in : " + repo.workdir());
            }
            resolve(repo);
          })
    ));
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
 * @returns an authenticated github connection.
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
 * @returns a promise of the hydrolysis.Analyzer with all of the info loaded.
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


async function openRepo(cloneOptions: nodegit.CloneOptions,
  ghRepo: GitHub.Repo,
  branchConfig: BranchConfig): Promise<ElementRepo> {
  const dir = path.join("repos", ghRepo.name);
  let repo: nodegit.Repository;
  if (util.existsSync(dir)) {
    let updatedRepo: nodegit.Repository;
    repo = await nodegit.Repository.open(dir).then((repo) => {
        updatedRepo = repo;
        return cloneRateLimiter.schedule(() =>
          updatedRepo.fetchAll(cloneOptions.fetchOpts)
        );
      }
    ).then(() => updatedRepo);
  } else {
    // Potential race condition if multiple repos w/ the same name are checked
    // out simultaneously.
    repo = await cloneRateLimiter.schedule(() => {
      return nodegit.Clone.clone(
        ghRepo.clone_url,
        dir,
        cloneOptions);
    });
  }
  let repoConfig = branchConfig[ghRepo.name];
  if (repoConfig && (repoConfig["branch"] || repoConfig["ref"])) {
    const ref = repoConfig["branch"] || repoConfig["ref"];
    repo = await checkoutBranch(repo, ref);
  } else if (opts["released"]) {
    repo = await checkoutLatestRelease(repo, dir);
  } else {
    repo = await checkoutBranch(repo, "master");
  }

  return new ElementRepo({repo, dir, ghRepo, analyzer: null});
}

function loadBranchConfig(config: SerializedBranchConfig): BranchConfig {
  let loadedConfig: BranchConfig = {};
  for (let key in config) {
    let shorthand = config[key];
    let orgRepoRef = shorthand.split("#");
    let ref = orgRepoRef[1];
    let orgRepo = orgRepoRef[0].split("/");
    let org = orgRepo[0];
    let repo = orgRepo[1];
    loadedConfig[key] = {repo: repo, org: org, ref: ref};
  }
  return loadedConfig;
}

async function _main(elements: ElementRepo[]) {
  if (opts["clean"]) {
    await promisify(rimraf)("repos");
  }
  if (!util.existsSync("repos")) {
     fs.mkdirSync("repos");
  }

  let configFile = opts["configfile"];
  let branchConfig: BranchConfig = {};
  if (util.existsSync(configFile)) {
    let loadedConfigFile: TattooConfig = JSON.parse(fs.readFileSync(configFile, "utf8"));
    if (loadedConfigFile["branch-config"]) {
      branchConfig = loadBranchConfig(loadedConfigFile["branch-config"]);
    }
    if (loadedConfigFile["wctflags"]) {
      opts["wctflags"] = loadedConfigFile["wctflags"].join(" ");
    }
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
    let repoPromise = openRepo(cloneOptions, ghRepo, branchConfig);
    // TODO(garlicnation): Checkout branch of a repository.
    promises.push(repoPromise);
  }

  elements.push.apply(elements,
      (await promiseAllWithProgress(promises, "Cloning repos...")));

  fs.writeFileSync("repos/.bowerrc", JSON.stringify({directory: "."}));
  const bowerCmd = resolve.sync("bower");
  child_process.execSync(`node ${bowerCmd} install web-component-tester`,
                         {cwd: "repos", stdio: "ignore"});

  // Transform code on disk and push it up to github
  // (if that's what the user wants)
  const cleanupPromises: Promise<any>[] = [];
  // All failing tests, or repos with a test/ dir that cause wct to hang.
  const excludes = new Set([
    "repos/style-guide",
    "repos/test-all",
    "repos/ContributionGuide",
    "repos/molecules", // Was deleted
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
  const testPromises: Array<Promise<TestResult>> = [];

  let elementsToTest: ElementRepo[];

  if (typeof opts["test-repo"] === "string") {
    if (opts["test-repo"]) {
      opts["test-repo"] = [opts["test-repo"]];
    } else {
      opts["test-repo"] = [];
    }
  }
  // "repos"
  const prefix = 6;
  if (opts["test-repo"].length > 0) {
    elementsToTest = elements.filter((el) => {
      return opts["test-repo"].indexOf(el.dir.substring(prefix)) > -1;
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
        return test(element, opts["wctflags"].split(" "));
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
