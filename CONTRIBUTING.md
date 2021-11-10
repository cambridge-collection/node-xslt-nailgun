# Contributing

## Commit Messages

We use [standard-version](https://github.com/conventional-changelog/standard-version) to generate version numbers and the changelog, so commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) spec.

## Testing

To run the tests using docker-compose:

`build-package` must be run before any of the test containers to compile the java code, and build the release package used by the integration tests:
```commandline
$ docker-compose run build-package
```

Then the `[integration-]test_node-*_java-*` containers can be run to execute the tests:
```commandline
$ docker-compose up test_node-10_java-11 integration-test_node-10_java-11 test_node-15_java-15 integration-test_node-15_java-15
```

## Publishing

Steps to publish a new release are:

1. Run `npx standard-version` to bump the version number and generate new entries in the changelog
2. Push the generated commit to the `main` branch, as well as the version tag
3. The Github Actions CI will notice the tag and publish a new version to the NPM registry
