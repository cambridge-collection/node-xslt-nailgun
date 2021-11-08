/**
 * XSLTExecutor tests which use Jest Fake Timers.
 *
 * These are separate from other XSLTExecutor tests because enabling and
 * disabling fake timers on a per-test level seems to be insufficient to prevent
 * native and fake timers interacting, resulting in the warning:
 *
 * > FakeTimers: clearTimeout was invoked to clear a native timer instead of one
 * > created by this library.
 */

import 'jest-xml-matcher';
import {runTransform} from './XSLTExecutor_common';

async function withAdvancingTime<T>(
  promise: Promise<T>,
  step = 20
): Promise<T> {
  const timers = await import('timers');
  const stepTime = timers.setInterval(() => {
    jest.advanceTimersByTime(step);
  }, step);
  return await promise.finally(() => {
    timers.clearInterval(stepTime);
  });
}

beforeAll(() => {
  jest.useFakeTimers();
});

test('executor reuses nailgun server when within an un-elapsed jvmKeepAliveTimeout', async () => {
  jest.useFakeTimers();
  const keepAlive = 2000;
  const jvmProcessID = expect.getState().currentTestName;

  const start = Date.now();
  const pid1 = await withAdvancingTime(runTransform(keepAlive, jvmProcessID));

  const after1 = Date.now();
  const elapsed1 = after1 - start;
  expect(elapsed1).toBeLessThan(keepAlive);

  // Advance to 1ms before the keepAlive timeout
  jest.advanceTimersByTime(keepAlive - elapsed1 - 1);
  // The keep-alive hasn't quite expired, so this will use the same server
  const pid2 = await withAdvancingTime(runTransform(keepAlive, jvmProcessID));

  const after2 = Date.now();
  const elapsed2 = after2 - after1;
  expect(elapsed2).toBeLessThan(keepAlive);

  // The keep-alive resets on each use, so now 2000ms needs to elapse - not 1 - before the server expires
  // Advance to 1ms before the (new) keepAlive timeout
  jest.advanceTimersByTime(keepAlive - elapsed2 - 1);
  expect(elapsed1 + elapsed2).toBeGreaterThan(keepAlive);
  const pid3 = await withAdvancingTime(runTransform(keepAlive, jvmProcessID));

  // The keep-alive has now expired, this execution will need to start a new server
  jest.advanceTimersByTime(keepAlive);
  const pid4 = await withAdvancingTime(runTransform(keepAlive, jvmProcessID));

  expect(pid1).toBe(pid2);
  expect(pid1).toBe(pid3);
  expect(pid1).not.toBe(pid4);

  // Clean up the second JVM by advancing timers to expire the keep-alive
  jest.runAllTimers();
});
