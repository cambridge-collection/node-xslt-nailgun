# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [0.3.0](https://github.com/cambridge-collection/node-xslt-nailgun/compare/v0.2.1...v0.3.0) (2020-12-14)


### ⚠ BREAKING CHANGES

* Update tapable to 2.x
* Minimum node version is now v10
* **java:** Java 11 is now the minimum version

### Features

* **java:** Create standalone server shutdown manager ([5b8246f](https://github.com/cambridge-collection/node-xslt-nailgun/commit/5b8246feb682e52ecee0cf1a5cdcd6e076df388f))
* **java:** Implement automatic process shutdown ([f67b040](https://github.com/cambridge-collection/node-xslt-nailgun/commit/f67b040c180ea2cd904ac89beaf2ef5bbb189ca9))
* **java:** Implement automatic server shutdown ([8f8390d](https://github.com/cambridge-collection/node-xslt-nailgun/commit/8f8390db1100303f23ba4ba5b7af2216a7fca405))
* Have server process stop itself if node dies ([c255810](https://github.com/cambridge-collection/node-xslt-nailgun/commit/c2558101eed78f6e72160b96ad5c5e4fce8dc2a6))
* Increase default JVM startup timeout to 10s ([419acbe](https://github.com/cambridge-collection/node-xslt-nailgun/commit/419acbe2be17eea3e81e5e1492847fc0b6d63209))
* **java:** Support logging to a file ([3195408](https://github.com/cambridge-collection/node-xslt-nailgun/commit/3195408395dd557b03e6dd3a4df4f7a3496f396c))


### Bug Fixes

* Correct type error in _internals.timeout() ([373d322](https://github.com/cambridge-collection/node-xslt-nailgun/commit/373d322ab68dd6aaa18526bc5292f54542f3027f))
* Remove unused @types/bluebird dependency ([bf66a9a](https://github.com/cambridge-collection/node-xslt-nailgun/commit/bf66a9a8a829fefd3547edc2a812d5419c824926))
* **java:** add missing newlines in `xslt transform` usage msg ([cc2f543](https://github.com/cambridge-collection/node-xslt-nailgun/commit/cc2f543d8a5a5a1af71680e7c09dd36c6f1b531c))
* **java:** Don't include "provided" jars in published package ([59d9ab3](https://github.com/cambridge-collection/node-xslt-nailgun/commit/59d9ab31ab571cb75828155150da14ee197b891b))
* **java:** Fix deadlock in automatic shutdown process ([d985dcc](https://github.com/cambridge-collection/node-xslt-nailgun/commit/d985dcc60e78e688c9596990e6a9e88dd672f6f7))
* **java:** Fix tests not running from maven build ([8888ab3](https://github.com/cambridge-collection/node-xslt-nailgun/commit/8888ab3ee27e11b3f16ea1b719aa6504ada70d35))


### build

* **java:** Require Java 11 ([ebedf58](https://github.com/cambridge-collection/node-xslt-nailgun/commit/ebedf5885f60d103e00f1b7d95c72e39d185aabc))
* Minimum node version is now v10 ([4f352f8](https://github.com/cambridge-collection/node-xslt-nailgun/commit/4f352f8090b956cbfdbe720bc695699e6a8f169c))
* Update tapable to 2.x ([e19eb9a](https://github.com/cambridge-collection/node-xslt-nailgun/commit/e19eb9a7e8f1bf4c6060e6705df7401ebbc775e0))

# 0.2.1

* Fix `@types/tapable` types not being in dependencies
* Update dependencies

# 0.2.0

* Export CreateOptions and ExecuteOptions types

# 0.1.0

* Support specifying XSLT global parameter values.
* Support specifying the startup timeout for the JVM server process via the `jvmStartupTimeout` option.
* Fix truncated/incorrect error output when concurrent errors occurred
* Fix intermittent test failures
* Fix startup timeouts not being reported clearly. When a timeout occurred, the serverStarted promise was being rejected with a rejected promise instead of the actual timeout error.

# 0.0.0-beta.4

- Change `execute()` signature to accept options object instead of positional arguments
- Keep nailgun server process alive for a short period after its last reference is dropped. This will make it easier to avoid JVM startups when using unrelated codepaths are executing transforms in quick succession.
- The [`debug`](https://www.npmjs.com/package/debug) package is used to log information on inner workings. To enable, use the environment variable `DEBUG=@lib.cam/xslt-nailgun:*` when running node.

# 0.0.0-beta.3

- Remove `get-port` dependency
- Use `bl` instead of `stream-buffers`
- Minor test refactoring

# 0.0.0-beta.2

- Support obtaining executor instances with distinct nailgun server processes
- Fix various bugs
- Include source maps in package
- Improve error reporting from nailgun server

# 0.0.0-beta.1

- Include missing README in package

# 0.0.0-beta.0

Initial release
