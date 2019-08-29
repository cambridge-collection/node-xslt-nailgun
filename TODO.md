# TODO

* Use UNIX domain sockets/Windows named pipes instead of TCP for server communication (seems to perform slightly better)
* Use `package.json#bundledDependencies` for vendoring jvmpin
* Update `execute()` signature to take an object:
  - make the system identifier arg optional
  - allow specifying the XSLT program as a string, not just a path
