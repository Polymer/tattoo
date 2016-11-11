import * as GitHub from 'github';
import * as nodegit from 'nodegit';
import { ElementRepo } from './element-repo';
import { BranchConfig, RepoConfig } from './model';
export declare function connectToGitHub(token: string): GitHubConnection;
export declare class GitHubConnection {
    private _cloneOptions;
    private _cloneRateLimiter;
    private _github;
    private _token;
    readonly repos: {
        getFromOrg(msg: GitHub.GetFromOrgOpts, cb: NodeCallback<GitHub.Repo[]>): void;
        get(msg: {
            user: string;
            repo: string;
        }, cb: NodeCallback<GitHub.Repo>): void;
    };
    readonly user: {
        get(msg: {}, cb: NodeCallback<GitHub.User>): void;
    };
    constructor(token: string);
    cloneRepo(ghRepo: GitHub.Repo, branchConfig: BranchConfig): Promise<ElementRepo>;
    /**
     * @returns a representation of a github repo from a string version
     */
    getRepoInfo(owner: string, repo: string): Promise<GitHub.Repo>;
    /**
     * @returns an array of repo names for the given owner (which is either an
     * org or user on github.)
     */
    getRepoNames(owner: string): Promise<string[]>;
    /**
     * @returns the current user info from github.
     */
    getUser(): Promise<GitHub.User>;
}
/**
 * Checks out a branch with a given name on a repo.
 *
 * returns a promise of the nodegit Branch object for the new branch.
 */
export declare function checkoutBranch(repo: nodegit.Repository, branchName: string): Promise<nodegit.Repository>;
/**
 * @returns a string representation of a RepoConfig of the form:
 *     "name:org/repo#ref"
 */
export declare function serializeRepoConfig(repo: RepoConfig): string;
/**
 * @returns a RepoConfig resulting from the parsed string of the form
 *     '[package:]owner/repo[#ref]' or 'owner/*[#ref]'
 */
export declare function parseRepoExpression(exp: string): RepoConfig;
