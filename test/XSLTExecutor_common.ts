import 'jest-xml-matcher';
import path from 'path';
import {URL} from 'url';
import {using, XSLTExecutor} from '../src';

export const testResourcesDir = path.resolve(
  __dirname,
  '../java/src/test/resources/uk/ac/cam/lib/cudl/xsltnail'
);
export const aXslPath = path.resolve(testResourcesDir, 'a.xsl');
export const paramsXslPath = path.resolve(testResourcesDir, 'params.xsl');
export const baseURIXslPath = path.resolve(testResourcesDir, 'base-uri.xsl');
export const aXmlPath = path.resolve(testResourcesDir, 'a.xml');
export const aXmlURI = new URL(aXmlPath, 'file://').toString();

export async function runTransform(
  keepAliveTimeout: number,
  jvmProcessID?: string
): Promise<number> {
  const {pid, result} = await using(
    XSLTExecutor.getInstance({
      jvmKeepAliveTimeout: keepAliveTimeout,
      jvmProcessID,
    }),
    async executor => {
      return {
        pid: getNailgunServerPID(executor),
        result: executor.execute({xml: '<a/>', xsltPath: aXslPath}),
      };
    }
  );

  await expect((await result).toString()).toEqualXML(`\
<?xml version="1.0" encoding="UTF-8"?>
<result><a/></result>`);

  return pid;
}

async function getNailgunServerPID(executor: XSLTExecutor): Promise<number> {
  const pid = (await executor['serverProcessRef'].resource)['process'].pid;
  if (pid === undefined) {
    throw new Error(
      'Failed to get PID associated with XSLTExecutor: ChildProcess has no pid'
    );
  }
  return pid;
}
