# NG TestHost Application

The NG TestHost Application is a simple Nailgun application which is
used by the test scripts.

## Building

Building the NG TestHost application requires both the [JDK](http://www.oracle.com/technetwork/java/javase/downloads/)
as well as the [Maven](http://maven.apache.org/) build tool.

Simply run `mvn -f test/ng-testhost/pom.xml clean package` to create the TestHost Application. This will create a `ng-testhost.jar` file in the `test/ng-testhost/target` folder which you can run.

## Running

To run the application, simply perform `java -jar test/ng-testhost/target/ng-testhost.jar`.

To see nailgun server log messages, add `-Djava.util.logging.config.file=test/ng-testhost/logging.properties`. The file `ngserver.log` will be created in the current directory.
