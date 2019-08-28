FROM ubuntu:18.04

RUN apt-get update && apt-get install -qq -y curl && \
    (curl -fsL https://deb.nodesource.com/setup_8.x | bash -) && \
    apt-get install -y --no-install-recommends nodejs openjdk-8-jre-headless && \
    npm install -g npm
