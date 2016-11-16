# Tattoo
Test all the things over and over.

## Installation

```
npm install -g tattoo
```

### Usage

***Test all repos***
```
mkdir tattoo_work
cd tattoo_work
tattoo
```

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

***Clean up installation***
```
rm -rf repos
```

***Or start with a fresh workspace as part of command***
```
tattoo -f
```
