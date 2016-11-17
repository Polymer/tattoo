# Tattoo
Test all the things over and over.

## Installation

```
npm install -g tattoo
```

### Usage

When you run tattoo, it will create and/or reuse a directory called
`./tattoo_workspace`, relative to the current working dir.  This folder is
used to clone test target repositories and their dependencies.  You can change
the directory used with the `--workspace-dir` or `-w` option.

***Test one repo***
```
tattoo -t PolymerElements/paper-input
```

***Test two repos***

```
tattoo -t PolymerElements/paper-input -t PolymerElements/paper-icon-button
```

***Test all the paper repos***

```
tattoo -t PolymerElements/paper-*
```

***Test all the paper repos on a specific branch***

```
tattoo -t "PolymerElements/paper-*#2.0-preview"
```

***Test all the repos except that one***

```
tattoo -t PolymerElements/* -s PolymerElements/style-guide
```

***Test all the repos, except that one***

```
tattoo -t PolymerElements/* -s PolymerElements/style-guide
```

***Test repos with a config.***

Create a json config file with `branch-config` and/or `wctflags` keys:

`tattoo_config.json`:
```
{
  "test": [
    "PolymerElements/paper-button#2.0-preview"
  ],
  "wctflags": ["--local", "canary"]
}
```

Then run:

```
tattoo
```

Config files support most of the same options as the command-line flags:

* `"test": ["PolymerElements/paper-button#2.0-preview", "PolymerElements/*", etc]`
  Repositories to test.
* `"skip-test": ["PolymerElements/iron-meta", "*/*-alpha", etc]`
  Repositories not to test.  Filters out items from the `test` list.
* `"repo": ["PolymerElements/iron-list", "PolymerElements/paper-*", etc]`
  Explicit repos to clone into workspace, but not test.  This is useful if you
  want to force a specific version of a web package that wouldn't be installed
  by default.

* `"exclude-repo": ["PolymerElements/style-guide", "*/*-deprecated", etc]`
  Repositories not to load.  Filters out items from the `repo` list.

* `"fresh": true|false`
  Clears the workspace for each run, i.e. will clone all repos from remote
  instead of updating local copies.

* `"github-token": "0123456789ABCDEF1337"`
  Provide a github token via this setting instead of using "github-token" file.

* `"latest-release": true|false`
  Set to update repos to the latest release when possible.

* `"verbose": true|false`
  When true, output all the things.

* `"wct-flags": ["--local", "chrome"]`
  Set to specify flags passed to wct.

* `"workspace-dir": "/tmp/tattoo-workspace"`
  Specify a different target folder to clone repos and run web-components-tester
  from.

***Clean up installation***
```
rm -rf tattoo_workspace
```

***Or start with a fresh workspace as part of command***
```
tattoo -f
```
