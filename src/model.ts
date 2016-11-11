
export interface RepoConfig {
  name?: string;
  org?: string;
  repo?: string;
  ref?: string;
}

export interface RepoConfigMap { [key: string]: RepoConfig; }

export interface SerializedBranchConfig { [key: string]: string; }

export interface SerializedTattooConfig {
  repo?: string[];
  'exclude-repo'?: string[];
  test?: string[];
  'skip-test'?: string[];
  wctflags?: string[];
}

export interface Options {
  'config-file': string;
  'exclude-repo': string[];
  'github-token'?: string;
  'fresh'?: boolean;
  'help': boolean;
  'latest-release'?: boolean;
  'repo': string[];
  'skip-test'?: string[];
  'test': string[];
  'verbose'?: boolean;
  'wct-flags': string[];
  'workspace-dir'?: string;
}

export interface ConfigFileOptions {
  'exclude-repo'?: string[];
  'github-token'?: string;
  'fresh'?: boolean;
  'latest-release'?: boolean;
  'repo'?: string[];
  'skip-test'?: string[];
  'test'?: string[];
  'verbose'?: boolean;
  'wct-flags'?: string[];
  'workspace-dir'?: string;
}

export interface Workspace {
  dir: string;
  repos: RepoConfigMap;
}
