declare module 'github' {
  class GitHubApi {
    constructor(options: GitHubApi.Options);
    repos: ({
      getFromOrg(
          msg: GitHubApi.GetFromOrgOpts,
          cb: NodeCallback<GitHubApi.Repo[]>): void;
      getFromUser(
          msg: GitHubApi.GetFromUserOpts,
          cb: NodeCallback<GitHubApi.Repo[]>): void;
      get(msg: {user: string, repo: string},
          cb: NodeCallback<GitHubApi.Repo>): void;
    });
    pullRequests: ({
      create(
          msg: GitHubApi.CreatePullRequestOpts,
          cb: NodeCallback<GitHubApi.Issue>): void;
    });
    issues: ({
      edit(msg: GitHubApi.IssuesEditOpts, cb: NodeCallback<GitHubApi.Issue>):
          void;
    });
    authenticate(credentials: {type: string, token: string}): void;
    user: ({
      get(msg: {}, cb: NodeCallback<GitHubApi.User>): void;
    });
  }
  namespace GitHubApi {
    interface Options {
      version: string;
      protocol: string;
    }
    interface CreatePullRequestOpts {
      user: string;
      repo: string;
      title: string;
      head: string;
      base: string;
      body?: string;
    }
    interface IssuesEditOpts {
      headers?: Object;
      user: string;
      repo: string;
      number: number;
      title?: string;
      body?: string;
      assignee?: string;
      milestone?: number;
      labels?: string[];
      state?: string;
    }
    interface GetFromOrgOpts {
      org: string;
      per_page?: number;
      page?: number;
    }
    interface GetFromUserOpts {
      user: string;
      per_page?: number;
      page?: number;
    }
    class Repo {
      owner: User;
      full_name: string;
      name: string;
      clone_url: string;
    }
    interface User {
      login: string;
    }
    interface Issue {
      number: number;
      title: string;
      body: string;
      assignee: User;
      milestone: Milestone;
      state: string;
      labels: {name: string, color: string, url: string}[];
      user: User;
    }
    interface PullRequest extends Issue {}
    interface Milestone {}
  }
  export = GitHubApi;
}
