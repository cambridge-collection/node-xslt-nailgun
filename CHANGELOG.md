# `@lib.cam/xslt-nailgun` Changelog

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
