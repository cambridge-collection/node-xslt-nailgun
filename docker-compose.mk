PARALLEL_SHELL = /bin/sh
DOCKER_RUN_PARALLEL_JOBS ?= 1
ALLOW_BUILD_WITH_DIRTY_FILES ?= false

docker-build-package:
	docker-compose run \
		-e "ALLOW_BUILD_WITH_DIRTY_FILES=$(ALLOW_BUILD_WITH_DIRTY_FILES)" \
		--rm build-package

docker-unit-tests:
	parallel --tag --jobs "$(DOCKER_RUN_PARALLEL_JOBS)" \
		docker-compose run --rm "{}" ::: \
		test_node-oldest_java-11
		test_node-latest_java-15

docker-integration-tests:
	parallel --tag --jobs "$(DOCKER_RUN_PARALLEL_JOBS)" \
		docker-compose run --rm "{}" ::: \
		integration-test_node-oldest_java-11 \
		integration-test_node-latest_java-15

docker-all-tests:
	parallel --tag --jobs "$(DOCKER_RUN_PARALLEL_JOBS)" \
		docker-compose run --rm "{}" ::: \
		test_node-oldest_java-11 \
		integration-test_node-oldest_java-11 \
		test_node-latest_java-15 \
		integration-test_node-latest_java-15

 .PHONY: docker-all-tests docker-integration-tests docker-unit-tests
