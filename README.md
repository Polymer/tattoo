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
tattoo -t paper-input --verbose
```

***Test two repos***

```
tattoo -t paper-input -t paper-icon-button --verbose
```

***Test repos with a config.***

Create a json config file with `branch-config` and/or `wctflags` keys:

`tattoo_config.json`:
```
{
  "branch-config": {
    "polymer" : "Polymer/polymer#lazy-register-extends",
    "paper-button" : "PolymerElements/paper-button#master"
  },
  "wctflags": ["-b", "canary"]
}

```
Then run:
```
tattoo -t paper-button -t paper-behaviors
```


***Fix broken installation***
```
rm -rf repos
```
