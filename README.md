# Tattoo
Test all the things over and over.

## Installation

```
git clone https://github.com/Polymer/tattoo
cd tattoo
npm install
```

### Usage

***Test all repos***
```
cd tattoo
./run.sh
# To re-run failed tests(for debugging)
./rerun.sh
```

***Test one repo***
```
cd tattoo
./run.sh -- -t paper-input --verbose
```

***Test two repos***

```
cd tattoo
./run.sh -- -t paper-input -t paper-icon-button --verbose
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
./run.sh -- -t paper-button -t paper-behaviors
```


***Fix broken installation***
```
rm -rf repos
```
