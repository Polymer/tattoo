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

/**
 * This file collects all of the functions for interacting with github and
 * manipulating git repositories on the filesystem.
 */

import * as Bottleneck from 'bottleneck';
import * as child_process from 'child_process';
import * as GitHub from 'github';
import * as nodegit from 'nodegit';
import * as path from 'path';
import * as promisify from 'promisify-node';

import {ElementRepo} from './element-repo';
import {checkoutLatestRelease} from './latest-release';
import {BranchConfig, RepoConfig} from './model';
import * as util from './util';

export function connectToGitHub(token: string): GitHubConnection {
  return new GitHubConnection(token);
}

export class GitHubConnection {
  private _cloneOptions: nodegit.CloneOptions;
  private _cloneRateLimiter: Bottleneck;
  private _github: GitHub;
  private _token: string;

  get repos() {
    return this._github.repos;
  }

  get user() {
    return this._github.user;
  }

  constructor(token: string) {
    const github = new GitHub({
      version: '3.0.0',
      protocol: 'https',
    });

    github.authenticate({type: 'oauth', token: token});

    this._cloneRateLimiter = new Bottleneck(20, 100);
    this._github = github;
    this._cloneOptions = {
      fetchOpts: {
        callbacks: {
          certificateCheck: function() {
            return 1;
          },
          credentials: function(url: string, userName: string) {
            return nodegit.Cred.userpassPlaintextNew(token, 'x-oauth-basic');
          }
        }
      }
    };
  }

  async cloneRepo(ghRepo: GitHub.Repo, branchConfig: BranchConfig):
      Promise<ElementRepo> {
    const dir = path.join('repos', ghRepo.name);
    let repo: nodegit.Repository;
    if (util.existsSync(dir)) {
      let updatedRepo: nodegit.Repository;
      repo =
          await nodegit.Repository.open(dir)
              .then((repo) => {
                updatedRepo = repo;
                return this._cloneRateLimiter.schedule(
                    () => updatedRepo.fetchAll(this._cloneOptions.fetchOpts));
              })
              .then(() => updatedRepo);
    } else {
      // Potential race condition if multiple repos w/ the same name are
      // checked
      // out simultaneously.
      repo = await this._cloneRateLimiter.schedule(() => {
        return nodegit.Clone.clone(ghRepo.clone_url, dir, this._cloneOptions);
      });
    }
    let repoConfig = branchConfig[ghRepo.name];
    if (repoConfig && (repoConfig['branch'] || repoConfig['ref'])) {
      const ref = repoConfig['branch'] || repoConfig['ref'];
      repo = await checkoutBranch(repo, ref);
      // TODO(usergenic): Consider adding a 'released' concept to the git repo
      // shorthand convention.
      // } else if (opts['released']) {
      //  repo = await checkoutLatestRelease(repo, dir);
    } else {
      repo = await checkoutBranch(repo, 'master');
    }

    return new ElementRepo({repo, dir, ghRepo, analyzer: null});
  }

  /**
   * @returns a representation of a github repo from a string version
   */
  async getRepoInfo(owner: string, repo: string): Promise<GitHub.Repo> {
    return promisify(this._github.repos.get)({user: owner, repo: repo})
        .then((response) => {
          // TODO(usergenic): Patch to _handle_ redirects and/or include
          // details in error messaging.  This was encountered because we
          // tried to request Polymer/hydrolysis which has been renamed to
          // Polymer/polymer-analyzer.
          if (isRedirect(response)) {
            console.log('Repo ${owner}/${repo} has moved permanently.');
            console.log(response);
            throw(`Repo ${owner}/${repo} could not be loaded.`);
          }
          return response;
        });
  }

  /**
   * @returns an array of repo names for the given owner (which is either an
   * org or user on github.)
   */
  async getRepoNames(owner: string): Promise<string[]> {
    const names: string[] = [];

    // Try to get the repo names assuming owner is an org.
    const getFromOrg = promisify(this._github.repos.getFromOrg);
    let pageSize = 50;
    let page = 0;
    let repos: GitHub.Repo[] = [];
    do {
      repos = await getFromOrg({org: owner, per_page: pageSize, page: page});
      for (const repo of repos) {
        names.push(repo.name);
      }
      ++page;
    } while (repos.length > 0);

    // TODO(usergenic): Update this function to support user repos as well as
    // the org repos.
    return names;
  }

  /**
   * @returns the current user info from github.
   */
  async getUser(): Promise<GitHub.User> {
    return promisify(this._github.user.get)({});
  }
}

/**
 * Checks out a branch with a given name on a repo.
 *
 * returns a promise of the nodegit Branch object for the new branch.
 */
export async function checkoutBranch(
    repo: nodegit.Repository, branchName: string): Promise<nodegit.Repository> {
  return new Promise<nodegit.Repository>(
      (resolve, reject) => (child_process.exec(
          'git checkout ' + branchName,
          {cwd: repo.workdir()},
          (error, stdout, stderr) => {
            if (error) {
              console.log(
                  'Error checkout out ' + branchName + 'in : ' +
                  repo.workdir());
            }
            resolve(repo);
          })));
}

/**
 * @returns a string representation of a RepoConfig of the form:
 *     "name:org/repo#ref"
 */
export function serializeRepoConfig(repo: RepoConfig): string {
  const ref = repo.ref ? `#${repo.ref}` : '#';
  return `${repo.name}:${repo.org}/${repo.repo}${ref}`;
}

/**
 * @returns a RepoConfig resulting from the parsed string of the form
 *     '[package:]owner/repo[#ref]' or 'owner/*[#ref]'
 */
export function parseRepoExpression(exp: string): RepoConfig {
  const hashSplit = exp.split('#');
  const slashSplit = hashSplit[0].split('/');
  const colonSplit = slashSplit[0].split(':').reverse();

  if (slashSplit.length !== 2 || hashSplit.length > 2 ||
      colonSplit.length > 2) {
    throw(
        `Repo '${exp}' is not in form user/repo, user/repo#ref, ` +
        `package:user/repo or user/*`);
  }

  const org = colonSplit[0];
  const repo = slashSplit[1];
  const ref = hashSplit[1];
  let name: string|undefined = undefined;

  if (repo.match(/\*/)) {
    if (colonSplit[1]) {
      throw(
          `Can not specify name ${colonSplit[1]} for a wildcard ` +
          `repo '${exp}'.`);
    }
  } else {
    name = colonSplit[1] || slashSplit[1];
  }
  return {org: org, repo: repo, ref: ref, name: name};
}

/**
 * @returns true if the repo is actually a response redirecting to another repo
 */
function isRedirect(repo: GitHub.Repo): boolean {
  return !!(repo['meta'] && repo['meta']['status'].match(/^301\b/));
}
