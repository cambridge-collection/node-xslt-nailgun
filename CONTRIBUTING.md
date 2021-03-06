# Contributing

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

1. Bump & tag with `npm version`
2. Push the tag to Bitbucket to run the Pipelines build
3. If the build succeeds, manually approve the publish using the button in the tag's Pipelines build
4. (Optionally) update the latest version of the package on npmjs.com using `npm dist-tag`


### 1. Bump version & tag

The Bitbucket pipelines CI build handles publishing to NPM. To publish a release, tag a new version using the [npm version][npm-version] command:

[npm-version]: https://docs.npmjs.com/cli/version

```commandline
$ npm version prerelease
v0.0.0-beta.1
```

You can also specify an exact version to bump to:

```commandline
$ npm version 0.1.0-beta.0
v0.1.0-beta.0
```

### 2. Run Pipelines build

Then push the tag to the repo:

```commandline
$ git push origin v0.0.0-beta.1
```

### 3. Manually approve package publication to npm

The pipelines build for the tag will build as for normal commits, but pausing before actually pushing to NPM. You can trigger the final push stage from the pipelines build page for the new tag.

### 4. Set latest package version on npm

Publishing the package to npm doesn't update what npm considers to be the latest version of the package. e.g the version that you see when you visit https://www.npmjs.com/package/@lib.cam/xslt-nailgun or run `$ npm install @lib.cam/xslt-nailgun` (without specifying a version). To set the latest version, run:

```commandline
$ # Sub X.Y.Z with the actual version
$ npm dist-tag add @lib.cam/xslt-nailgun@X.Y.Z latest
```

You'll need to have an [npm auth token](https://docs.npmjs.com/using-private-packages-in-a-ci-cd-workflow) set up to do this.
