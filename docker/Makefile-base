include config.conf

tag_version = $(IMAGE_ORGANISATION)/$(IMAGE_NAME):$(IMAGE_VERSION)
tag_latest = $(IMAGE_ORGANISATION)/$(IMAGE_NAME):$(IMAGE_VERSION)

build:
	docker build -t $(tag_version) -t $(tag_latest) .

publish: publish-version publish-latest

publish-version: build
	@echo "Publish $(tag_version)"
	docker push $(tag_version)

publish-latest: build
	@echo "Publish $(tag_latest)"
	docker push $(tag_latest)

.PHONY: build publish publish-latest publish-version
