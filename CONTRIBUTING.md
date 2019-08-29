# Contributing

## Publishing

The Bitbucket pipelines CI build handles publishing to NPM. To publish a release, tag a new version using the [npm version][npm-version] command:

[npm-version]: https://docs.npmjs.com/cli/version

```commandline
$ npm version prerelease
v0.0.0-beta.1
```

Then push the tag to the repo:

```commandline
$ git push origin v0.0.0-beta.1
```

The pipelines build for the tag will build as for normal commits, but pausing before actually pushing to NPM. You can trigger the final push stage from the pipelines build page for the new tag.
