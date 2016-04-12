import * as nodegit from "nodegit";
import * as semver from "semver";


export async function checkoutLatestRelease(
    repo: nodegit.Repository,
    dir?: string)
        : Promise<nodegit.Repository> {
  const tags = await nodegit.Tag.list(repo);
  let latestRelease: string;
  if (tags && tags.length > 0) {
    try {
      latestRelease = tags.sort(semver.rcompare)[0];
    } catch (err) {
      // We couldn't pick a release, so we'll just bow out here.
      return repo;
    }
  } else {
    return repo;
  }
  let commit: nodegit.Commit;
  try {
    commit = await repo.getReferenceCommit(latestRelease);
  }
  catch (err) {
    console.log(dir, err);
    return repo;
  }
  repo.setHeadDetached(commit.id(), repo.defaultSignature(), "Checkout: HEAD " + commit.id());
  return repo;
}
