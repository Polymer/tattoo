# Tattoo
Test all the things over and over.

## Installation

```
npm install -g tattoo
```

## GitHub token

 - First, generate a GitHub token here:  https://github.com/settings/tokens
 - 3 ways to make it available to tattoo:
    1. Put the token in a file called `github-token`
    2. Pass it to tattoo every time with `--github-token` CLI option.
    3. Put it in your `tattoo_config.json` file with key `"github-token"`

### Usage

When you run tattoo, it will create and/or reuse a directory called
`./tattoo_workspace`, relative to the current working dir.  This folder is
used to clone test target repositories and their dependencies.  You can change
the directory used with the `--workspace-dir` or `-w` option.

***Test one repo***
```
tattoo PolymerElements/paper-input
```
This is the simplest possible case.  What actually happens here is that tattoo
clones the repository `https://github.com/PolymerElements/paper-input` into the
local filesystem as `./tattoo_workspace/paper-input`, installs all of the
`dependencies` and `devDependencies` in its `bower.json` also into
`./tattoo_workspace`.  Then it essentially runs
`cd ./tattoo_workspace/paper-input && wct --local chrome`.

***Test two repos***

```
tattoo PolymerElements/paper-input PolymerElements/paper-icon-button
```
In this case, tattoo clones both repositories into `./tattoo_workspace` as
`paper-input` and `paper-icon-button`, then installs all of their combined
`dependencies` and `devDependencies` into `./tattoo_workspace`.  Conflicts in
dependencies are currently resolved arbitrarily, but there's an
[issue (#24)](https://github.com/Polymer/tattoo/issues/24) to address that.
It then runs `wct` for both custom element repos.

***Test all the paper repos***

```
tattoo PolymerElements/paper-*
```
Tattoo supports wildcards in repository references so the above actually clones
all the PolymerElements repos that start with `paper-`, installs their
dependencies and runs `wct` for all of the paper element repos.

***Test all the paper repos on a specific branch***

```
tattoo "PolymerElements/paper-*#2.0-preview"
```
In the previous examples, tattoo cloned the requested repositories and simply
ran tests on whatever HEAD of their repo is, (typically `master` branch).  It
is frequently the case that a specific branch, tag or commit/SHA1 reference is
the desired target for test.  Tattoo supports this with the `#hashref` syntax
so the above example `PolymerElements/paper-*#2.0-preview` would tell tattoo
to run tests for all the `paper-` elements which have a branch called
`2.0-preview`.  If the branch name is invalid for a given repo, it should be
skipped/excluded.

***Test all the repos except that one***

```
tattoo PolymerElements/* -s PolymerElements/style-guide
```

***Test repos with different browser***
```
tattoo PolymerElements/* --wct-flags="--local safari"
```

***Test repos with a config.***

Create a `tattoo_config.json` file to persist a base of options to tattoo.  For
example:
```
{
  "test": [
    "PolymerElements/paper-*"
  ],
  "require": [
    "Polymer/polymer#2.0-preview"
  ]
  "verbose": true,
  "wctflags": ["--local canary", "--color"]
}
```
Tattoo will automatically find that file, load its options, and *then* apply
any additional command line arguments.  So you could simply run with the config
as-is by typing:

```
tattoo
```
Or test the `paper-button` repo and the `paper-hat` repo by typing the
following, since `paper-button` is in the config and arguments are additive.
```
tattoo PolymerElements/paper-hat
```

Config files support most of the same options as the command-line flags:

* `"test": ["PolymerElements/paper-button#2.0-preview", "PolymerElements/*", etc]`
  Repositories to test.

* `"require": ["PolymerElements/iron-list", "PolymerElements/paper-*", etc]`
  Explicit repos to clone into workspace, but not test.  This is useful if you
  want to force a specific version of a web package that wouldn't be installed
  by default.

* `"exclude": ["PolymerElements/style-guide", "*/*-deprecated", etc]`
  Repositories not to load.  Filters out items from the `test` and `require`
  list.

* `"skip-test": ["PolymerElements/iron-meta", "*/*-alpha", etc]`
  Repositories not to test.

* `"fresh": true|false`
  Clears the workspace for each run, i.e. will clone all repos from remote
  instead of updating local copies.

* `"github-token": "0123456789ABCDEF1337"`
  Provide a github token via this setting instead of using "github-token" file.

* `"verbose": true|false`
  When true, output all the things.

* `"wct-flags": ["--local chrome"]`
  Set to specify flags passed to wct.

* `"workspace-dir": "/tmp/tattoo-workspace"`
  Specify a different target folder to clone repos and run web-component-tester
  from.

***Clean up installation***
```
rm -rf tattoo_workspace
```

***Or start with a fresh workspace as part of command***
```
tattoo -f
```

***Get help on the cli***
```
tattoo -h

tattoo (test all the things over & over)

  Runs the web-component-tester on custom element git repositories.

  Run test for a specific GitHub repository:
  $ tattoo PolymerElements/paper-button

  Run test for a whole bunch of GitHub repositories:
  $ tattoo PolymerElements/paper-*

  See more examples at https://github.com/Polymer/tattoo

Options

  -t, --test string[]          Repositories to test. (This is the default
                               option, so the --test/-t switch itself is not
                               required.)
  -s, --skip-test string[]     Repositories not to test. Overrides the values
                               from the --test
  -r, --require string[]       Explicit repos to load. Specifying explicit
                               repos will disable running on the default set of
                               repos for the user.
  -e, --exclude string[]       Repositories not to load. Overrides the values
                               from the --repo and --test flag.
  -f, --fresh                  Set to clone all repos from remote instead of
                               updating local copies.
  -c, --config-file string     Specify path to a json file which contains base
                               configuration values. Command-line options flags
                               supercede values in file where they differ. If
                               file is missing, Tattoo will ignore.
  -C, --color string           Set to "off" if you do not want color in your
                               output. Defaults to "on".
  -g, --github-token string    Provide github token via command-line flag
                               instead of "github-token" file.
  -v, --verbose                Set to print output from failed tests.
  -w, --wct-flags string[]     Set to specify flags passed to wct.
  -d, --workspace-dir string   Override the default path "tattoo_workspace"
                               where the repositories will be cloned and web-
                               component-tester will run.
  -h, --help                   Print this usage example.
  -V, --version                Print out the version of tattoo.
```
