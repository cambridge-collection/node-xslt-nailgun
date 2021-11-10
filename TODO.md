# TODO

* Evaluate Saxon's (somewhat) new [saxon-js](https://www.npmjs.com/package/saxon-js) package to see
  if it can either replace this, or we could use it as an alternate backend to avoid needing a JVM
  & RPC.
* Use a conventional, well-supported RPC technology (such as gRPC) instead of Nailgun. The Nailgun
  server itself and node packages for it are not actively developed (hence vendoring jvmpin here
  currently). The server would be more useful if it used a popular RPC framework as it'd be more
  likely to be reused elsewhere. I went with Nailgun initially in order to avoid native dependencies
  blocking node version upgrades, and because the simplicity and ease of debugging Nailgun seemed
  appealing. gRPC for one now has a pure js node client, and the ability to use/debug the Nailgun
  server from its CLI client interface has not borne out to be useful in practice.
* Use UNIX domain sockets/Windows named pipes instead of TCP for server communication (seems to
  perform slightly better)
* Use `package.json#bundledDependencies` for vendoring jvmpin
* Have the server occasionally check that its parent process is still alive?
* Capture and report SAXON warnings. Currently they are only visible when an error also occurs.
