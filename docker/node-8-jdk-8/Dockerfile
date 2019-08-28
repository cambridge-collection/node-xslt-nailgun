FROM ubuntu:18.04

RUN apt-get update && apt-get install -qq -y --no-install-recommends openjdk-8-jdk
RUN apt-get install -qq -y curl && \
    (curl -fsL https://deb.nodesource.com/setup_8.x | bash -) && \
    apt-get install -y --no-install-recommends nodejs build-essential maven jq git && \
    npm install -g npm
COPY toolchains.xml /root/.m2/
