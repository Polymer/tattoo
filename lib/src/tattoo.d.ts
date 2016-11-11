import * as model from './model';
export declare class Tattoo {
    private _excludeRepos;
    private _fresh;
    private _github?;
    private _githubToken;
    private _githubUser?;
    private _repos;
    private _skipTests;
    private _tests;
    private _testRateLimiter;
    private _wctFlags;
    private _workspace;
    constructor(options: model.Options);
    /**
     * Given all the repos defined in the workspace, lets iterate through them
     * and either clone them or update their clones and set them to the specific
     * refs.
     */
    _cloneOrUpdateWorkspaceRepos(): Promise<void>;
    /**
     * Connect is basically an initialization routine but involves API calls to
     * GitHub to get information about repos etc, mostly to support wildcarded
     * RepoConfig options and identify invalid/unavailable repos.
     */
    _connectToGitHub(): Promise<void>;
    _determineWorkspaceRepos(): Promise<void>;
    _loadConfigFile(options: model.Options): void;
    _prepareWorkspaceFolder(): Promise<void>;
    _setGitHubToken(options: model.Options): void;
    _testAllTheThings(): Promise<void>;
    run(): Promise<void>;
}
