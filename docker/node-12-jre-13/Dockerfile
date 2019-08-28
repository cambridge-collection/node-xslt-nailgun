FROM ubuntu:19.04

RUN apt-get update && apt-get install -qq -y curl && \
    (curl -fsL https://deb.nodesource.com/setup_12.x | bash -) && \
    apt-get install -y --no-install-recommends nodejs openjdk-13-jre-headless && \
    npm install -g npm
