ARG NODE_VERSION=v10.23.0
ARG JAVA_VERSION_SHORT=11

FROM ubuntu:focal AS node
ARG NODE_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates
RUN curl -o /tmp/install.sh https://raw.githubusercontent.com/nvm-sh/nvm/v0.37.0/install.sh
RUN bash /tmp/install.sh
ENV NVM_DIR="/root/.nvm"
RUN . $NVM_DIR/nvm.sh \
  && nvm install $NODE_VERSION \
  # link the (dynamically-named) version dir to a fixed location
  && ln -s "$(dirname "$(dirname "$(nvm which $NODE_VERSION)")")" /opt/node


FROM maven:3-adoptopenjdk-${JAVA_VERSION_SHORT} AS packager
ARG NODE_VERSION
ARG JAVA_VERSION_SHORT
ENV CI=true
COPY --from=node /opt/node/ /opt/node/
ENV PATH=/opt/node/bin:$PATH
RUN apt-get update && \
  apt-get install -y --no-install-recommends build-essential python3 jq && \
  rm -rf /var/lib/apt/lists/*

# Generate a toolchains.xml
COPY docker/toolchains-template.xml /tmp/toolchains-template.xml
RUN mkdir -p /root/.m2 \
  && cat /tmp/toolchains-template.xml \
  | xargs -0 -I "{}" printf "{}" "$JAVA_VERSION_SHORT" "$JAVA_HOME" > /root/.m2/toolchains.xml


FROM adoptopenjdk:${JAVA_VERSION_SHORT}-jre-hotspot-focal AS test-runner-base
ARG NODE_VERSION
COPY --from=node /opt/node/ /opt/node/
ENV PATH=/opt/node/bin:$PATH
RUN adduser --disabled-password --gecos '' ci

# procps contains pgrep which is needed by integration tests. Python is used by node-gyp when
# building native node modules.
RUN apt-get update && \
  apt-get install -y --no-install-recommends build-essential procps python3 && \
  rm -rf /var/lib/apt/lists/*

RUN echo "set -euxo pipefail" >> ~/.bashrc

WORKDIR /code
RUN mkdir /code/java && chown -R ci:ci /code
USER ci

FROM test-runner-base AS test-runner
CMD echo "Node version:" && node --version && \
  echo "Java version:" && java -version && \
  echo "Copying project files..." && \
  cd /project-files && \
  find . \( -name .git -o -name build -o -path ./java/target -o \
  -name .idea -o -name node_modules -o -name test-reports \) -prune -o -type f \
  -exec install -pDT "{}" "/code/{}" \; && \
  cd /code && \
  ( test -n "$(find java/target/jars -name '*.jar' 2>/dev/null)" \
  || ( echo 'Error: No jars found at java/target/jars, `docker-compose run build-package` needs to be run to create them.' \
  && exit 1 ) ) && \
  npm ci && \
  npm run test


FROM test-runner-base AS integration-test-runner
CMD echo "Node version:" && node --version && \
  echo "Java version:" && java -version && \
  echo "Copying project files..." && \
  cd /project-files && \
  find ./integration-test ./examples \( -name node_modules -o -name test-reports \) -prune -o -type f \
  -exec install -pDT "{}" "/code/{}" \; && \
  cd /code && \
  echo "\nRunning integration tests..." && \
  integration-test/run-all.sh && \
  echo "\nRunning examples..." && \
  examples/run-all.sh
