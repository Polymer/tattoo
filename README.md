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

***Fix broken installation***
```
rm -rf repos
```
