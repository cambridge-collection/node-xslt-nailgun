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
		test_node-oldest_java-oldest
		test_node-latest_java-latest

docker-integration-tests:
	parallel --tag --jobs "$(DOCKER_RUN_PARALLEL_JOBS)" \
		docker-compose run --rm "{}" ::: \
		integration-test_node-oldest_java-oldest \
		integration-test_node-latest_java-latest

docker-all-tests:
	parallel --tag --jobs "$(DOCKER_RUN_PARALLEL_JOBS)" \
		docker-compose run --rm "{}" ::: \
		test_node-oldest_java-oldest \
		integration-test_node-oldest_java-oldest \
		test_node-latest_java-latest \
		integration-test_node-latest_java-latest

 .PHONY: docker-all-tests docker-integration-tests docker-unit-tests
