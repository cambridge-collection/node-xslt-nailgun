# Docker images

This directory contains definitions for the docker images used in the CI builds.

# Building/publishing

Each directory contains:

* `Makefile` - containing build/publish steps
* `Dockerfile` - defining the image
* `config.conf` - defining the image name and version

## Building

To build an image, cd into the directory in question, and run:

```console
$ sudo make build
```

## Publishing

To publish an image to dockerhub, cd into the directory in question, and run:

```console
$ sudo make publish
```
