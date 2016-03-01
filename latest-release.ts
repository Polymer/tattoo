import * as nodegit from "nodegit";
import * as semver from "semver";


export async function checkoutLatestRelease(
    r: nodegit.Repository|Promise<nodegit.Repository>, dir?: string)
        : Promise<nodegit.Repository> {
  const repo = await r;
  const repos = await nodegit.Tag.list(repo);
  let latestRelease: string;
  if (repos && repos.length > 0) {
    try {
      latestRelease = repos.sort(semver.rcompare)[0];
    } catch (err) {
      // We couldn't pick a release, so we'll just bow out here.
      return repo;
    }
  } else {
    return repo;
  }
  console.log("Looking up tag: ", latestRelease);
  let commit: nodegit.Commit;
  try {
    commit = await repo.getReferenceCommit(latestRelease);
  }
  catch (err) {
    console.log(dir, err);
    return repo;
  }
  console.log("Attempting to set version to " + commit);
  repo.setHeadDetached(commit.id(), repo.defaultSignature(), "Checkout: HEAD " + commit.id());
  return repo;
}
