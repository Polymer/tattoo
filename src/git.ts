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

/**
 * This file collects all of the functions for interacting with github and
 * manipulating git repositories on the filesystem.
 */

import Bottleneck from 'bottleneck';
import * as child_process from 'child_process';
import * as GitHub from 'github';
import * as nodegit from 'nodegit';
import * as path from 'path';
import * as promisify from 'promisify-node';
import * as rimraf from 'rimraf';

// import {checkoutLatestRelease} from './latest-release';
import * as util from './util';

/**
 * Represents GitHub repository + optional specific branch/ref requested by the
 * tattoo user.
 */
export interface GitHubRepoRef {
  // The branch name or SHA of the commit to checkout in the clone.
  checkoutRef?: string;

  // The name of the org or user who owns the repo on GitHub.
  ownerName?: string;

  // The name of the repo on GitHub.
  repoName?: string;
}

/**
 * GitHubConnection is a wrapper class for the GitHub npm package that
 * assumes action as-a-user, and a minimal set of supported API calls (mostly
 * to do with listing and cloning owned repos) using a token and building in
 * rate-limiting functionality using the Bottleneck library to throttle API
 * consumption.
 */
export class GitHubConnection {
  private _cache: {repos: Map<string, Map<string, GitHub.Repo>>};
  private _cloneOptions: nodegit.CloneOptions;
  private _cloneRateLimiter: Bottleneck;
  private _github: GitHub;
  private _token: string;
  private _user: GitHub.User;

  constructor(token: string) {
    this.resetCache();
    this._token = token;
    this._github = new GitHub({
      version: '3.0.0',
      protocol: 'https',
    });
    this._github.authenticate({type: 'oauth', token: token});
    // TODO: Make the arguments to rate limiter configurable.
    this._cloneRateLimiter = new Bottleneck(20, 100);
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

  resetCache() {
    this._cache = {repos: new Map()};
  }

  /**
   * Given a github repository and a directory to clone it into, return an
   * ElementRepo once it has been cloned and checked out.  If the clone already
   * exists, fetch the latest updates from the remote repository.
   * TODO(usergenic): Split this into two methods?
   * TODO(usergenic): The two let variables here are obnoxious; clean them up.
   *   See: https://github.com/Polymer/tattoo/pull/22#discussion_r88372397
   */
  async cloneOrFetch(githubRepo: GitHub.Repo, cloneDir: string):
      Promise<nodegit.Repository> {
    if (util.existsSync(cloneDir)) {
      const openRepo = await nodegit.Repository.open(cloneDir);
      if (openRepo) {
        return await this._cloneRateLimiter
            .schedule(() => openRepo.fetchAll(this._cloneOptions.fetchOpts))
            .then(() => openRepo);
      }
    }
    return await this._cloneRateLimiter.schedule(() => {
      return nodegit.Clone.clone(
          githubRepo.clone_url, cloneDir, this._cloneOptions);
    });
  }

  /**
   * @returns a representation of a github repo from a string version
   */
  async getRepoInfo(owner: string, repo: string): Promise<GitHub.Repo> {
    if (this._cache.repos.has(owner.toLowerCase()) &&
        this._cache.repos.get(owner.toLowerCase()).has(repo.toLowerCase())) {
      return this._cache.repos.get(owner.toLowerCase()).get(repo.toLowerCase());
    }
    return promisify(this._github.repos.get)({user: owner, repo: repo})
        .then((response) => {
          // TODO(usergenic): Patch to _handle_ redirects and/or include
          // details in error messaging.  This was encountered because we
          // tried to request Polymer/hydrolysis which has been renamed to
          // Polymer/polymer-analyzer and the API doesn't auto-follow this.
          if (isRedirect(response)) {
            console.log('Repo ${owner}/${repo} has moved permanently.');
            console.log(response);
            throw new Error(`Repo ${owner}/${repo} could not be loaded.`);
          }
          return response;
        });
  }

  /**
   * @returns an array of repo (full_name) values for the given owner (which is
   * either an org or user on github.)
   */
  async getRepoFullNames(owner: string): Promise<string[]> {
    const names: string[] = [];

    // Try to get the repo names assuming owner is an org.
    const getFromOrg = promisify(this._github.repos.getFromOrg);
    const getFromUser = promisify(this._github.repos.getFromUser);
    let pageSize = 50;
    let page = 0;
    let repos: GitHub.Repo[] = [];
    const ownerRepoMap = new Map<string, GitHub.Repo>();
    this._cache.repos.set(owner.toLowerCase(), ownerRepoMap);
    let isOrg = true;
    do {
      if (isOrg) {
        await getFromOrg({org: owner, per_page: pageSize, page: page})
            .then((results) => {
              repos = results;
            })
            .catch((error) => {
              // Maybe owner is not an org.
              isOrg = false;
            });
      }
      if (!isOrg) {
        repos = await getFromUser({user: owner, per_page: pageSize, page: page})
                    .catch((error) => []);
      }
      for (const repo of repos) {
        names.push(repo.full_name);
        ownerRepoMap.set(repo.name.toLowerCase(), repo);
      }
      ++page;
    } while (repos.length > 0);

    // TODO(usergenic): Update this function to support user repos as well as
    // the org repos.
    return names;
  }

  /**
   * Given a nodegit repository, issue a git pull to bring it up to date.
   */
  async update(nodegitRepo: nodegit.Repository) {
    await nodegitRepo.fetch('origin', this._cloneOptions.fetchOpts);
  }

  /**
   * @returns the current user info from GitHub.  The current user is
   * determined by the token being used.
   */
  async getCurrentUser(): Promise<GitHub.User> {
    return promisify(this._github.user.get)({});
  }
}

/**
 * Checks out a branch with a given name on a repo.
 *
 * @returns the nodegit Branch object for the new branch.
 */
export async function checkoutOriginRef(
    nodegitRepo: nodegit.Repository,
    checkoutRef: string): Promise<nodegit.Repository> {
  return nodegitRepo.getBranch('refs/remotes/origin/' + checkoutRef)
      .then(function(reference) {
        // checkout branch
        nodegitRepo.checkoutRef(reference);
      })
      .then(() => nodegitRepo);
}

export async function getHeadSha(repo: nodegit.Repository): Promise<string> {
  return repo.getHeadCommit().then(
      (commit) => commit['sha'] ? commit['sha']() : '');
}
/**
 * @returns a string representation of a RepoRef of the form:
 *     "name:org/repo#ref"
 */
export function serializeGitHubRepoRef(repoRef: GitHubRepoRef): string {
  const checkoutRef = repoRef.checkoutRef ? `#${repoRef.checkoutRef}` : '';
  return `${repoRef.ownerName}/${repoRef.repoName}${checkoutRef}`;
}

/**
 * @returns a GitHubRepoRef resulting from the parsed string of the form:
 *     `ownerName/repoName[#checkoutRef]`
 */
export function parseGitHubRepoRefString(refString: string): GitHubRepoRef {
  const hashSplit = refString.split('#');
  const slashSplit = hashSplit[0].split('/');

  if (slashSplit.length !== 2 || hashSplit.length > 2) {
    throw new Error(
        `Repo '${refString}' is not in form user/repo or user/repo#ref`);
  }

  const owner = slashSplit[0];
  const repo = slashSplit[1];
  const ref = hashSplit[1];

  return {ownerName: owner, repoName: repo, checkoutRef: ref};
}

/**
 * @returns whether the matcherRef matches the targetRef, which allows for the
 *     case-insensitive match as well as wildcards.
 * TODO(usergenic): This method intentionally doesn't match the checkout refs
 * of two repo refs.  We'll need this method to support an option to do so in
 * order to support wildcard exclude and skip-tests options to filter out items
 * by checkout refs.
 */
export function matchRepoRef(
    matcherRef: GitHubRepoRef, targetRef: GitHubRepoRef): boolean {
  return util.wildcardRegExp(matcherRef.ownerName).test(targetRef.ownerName) &&
      util.wildcardRegExp(matcherRef.repoName).test(targetRef.repoName);
}

/**
 * Convenience wrapper to nodegit's repository open.
 */
export async function openRepo(cloneDir: string): Promise<nodegit.Repository> {
  return nodegit.Repository.open(cloneDir);
}

/**
 * @returns true if the repo is actually a response redirecting to another repo
 */
function isRedirect(repo: GitHub.Repo): boolean {
  return !!(repo['meta'] && repo['meta']['status'].match(/^301\b/));
}
