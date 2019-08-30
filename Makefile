SHELL = /bin/bash
.SHELLFLAGS=-o errexit -c

all: clean pack

compile-typescript: install
	npm run build

compile-java:
	mvn --batch-mode --file java/pom.xml clean verify

build/dist-root/jars: build/dist-root compile-java
	cp -a java/target/jars build/dist-root/

build/dist-root/package.json: FILTER = '\
	. as $$root | \
	.main |= "./lib/index.js" | \
	.types |= "./lib/index.d.ts" | \
	.["uk.ac.cam.lib.cudl.xslt-nailgun"].serverJarsPath |= "./jars" | \
	.scripts.prepack |= $$root.scripts._prepack | \
	del(.scripts._prepack) | \
	.publishConfig |= {tag: ($$root.version | if test("^(?:\\d+\\.){2}\\d+$$") then "latest" else "next" end)}'
build/dist-root/package.json: package.json build/dist-root
	jq $(FILTER) $< > $@

build/dist-root/README.md: README.md build/dist-root
	cp $< $@

build/dist-root/lib/vendor: build/dist-root/lib
	cp -a lib/vendor build/dist-root/lib/

build/dist-root:
	mkdir -p build/dist-root

build/dist-root/lib:
	mkdir -p build/dist-root

build/dist-root/src: build/dist-root
	cp -a src build/dist-root/

ensure-clean-checkout:
# Refuse to build a package with local modifications, as the package may end up
# containing the modifications rather than the committed state.
	@DIRTY_FILES="$$(git status --porcelain)" ; \
	if [ "$$DIRTY_FILES" != "" ]; then \
		echo "Error: git repo has uncommitted changes, refusing to generate package as the contents may not be reproducible:" ; \
		echo "$$DIRTY_FILES" ; \
		exit 1 ; \
	fi

normalise-permissions:
# npm pack includes local file permissions in the .tgz, which can differ between
# local and CI environments, breaking reproducibility.
	find build -type f -exec chmod u=rw,g=r,o=r {} +

pack: ensure-clean-checkout compile-typescript build/dist-root \
build/dist-root/lib/vendor build/dist-root/jars build/dist-root/src \
build/dist-root/package.json build/dist-root/README.md normalise-permissions
	cd build && npm pack ./dist-root

install:
	npm ci

clean: clean-build clean-java

clean-java:
	mvn --batch-mode --file java/pom.xml clean

clean-build:
	rm -rf build

.PHONY: clean clean-java clean-build compile-typescript compile-java ensure-clean-checkout normalise-permissions
