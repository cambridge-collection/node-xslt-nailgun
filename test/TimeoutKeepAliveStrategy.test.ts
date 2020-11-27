import {Closable} from '../src';
import {
  AutoCloserReference,
  DefaultAutoCloserKeepAliveHooks,
  TimeoutKeepAliveStrategy,
} from '../src/_internals';

test('is alive by default', () => {
  const keepAlive = new TimeoutKeepAliveStrategy(1000);
  expect(keepAlive.isAlive()).toBe(true);
});

test('is closed immediately with timeout of 0', async () => {
  const keepAlive = new TimeoutKeepAliveStrategy(0);
  const onDead = jest.fn(callback => callback());
  const autoCloserHooks = new DefaultAutoCloserKeepAliveHooks<Closable>();

  keepAlive.hooks.dead.tapAsync('test', onDead);
  keepAlive.accept(autoCloserHooks);
  const ref = {} as AutoCloserReference<Closable>;
  autoCloserHooks.refOpened.call(ref);
  await autoCloserHooks.refClosed.promise(ref);
  expect(keepAlive.isAlive()).toBe(false);
  expect(onDead.mock.calls.length).toBe(1);
});

test('is closed after timeout expires', async () => {
  jest.useFakeTimers();
  const keepAlive = new TimeoutKeepAliveStrategy(1000);
  const onDead = jest.fn(callback => callback());
  const autoCloserHooks = new DefaultAutoCloserKeepAliveHooks<Closable>();

  keepAlive.hooks.dead.tapAsync('test', onDead);
  keepAlive.accept(autoCloserHooks);
  const ref = {} as AutoCloserReference<Closable>;
  autoCloserHooks.refOpened.call(ref);
  await autoCloserHooks.refClosed.promise(ref);

  jest.advanceTimersByTime(999);
  expect(keepAlive.isAlive()).toBe(true);
  jest.advanceTimersByTime(1);
  expect(keepAlive.isAlive()).toBe(false);
  expect(onDead.mock.calls.length).toBe(1);
});

test('reports close errors', async () => {
  const keepAlive = new TimeoutKeepAliveStrategy(0);
  const onAsyncCloseError = jest.fn(e => true); // report that we handled the error
  const err = new Error('boom');
  const onDead = jest.fn(callback => callback(err)); // fail with the error
  const autoCloserHooks = new DefaultAutoCloserKeepAliveHooks<Closable>();

  keepAlive.hooks.asyncCloseError.tap('test', onAsyncCloseError);
  keepAlive.hooks.dead.tapAsync('test', onDead);
  keepAlive.accept(autoCloserHooks);

  const ref = {} as AutoCloserReference<Closable>;
  autoCloserHooks.refOpened.call(ref);
  await autoCloserHooks.refClosed.promise(ref);

  expect(keepAlive.isAlive()).toBe(false);
  expect(onDead.mock.calls.length).toBe(1);
  expect(onAsyncCloseError.mock.calls.length).toBe(1);
  expect(onAsyncCloseError.mock.calls[0][0]).toBe(err);
});

test('close errors are thrown if asyncCloseError is not tapped', async () => {
  const keepAlive = new TimeoutKeepAliveStrategy(0);
  const err = new Error('boom');
  const onDead = jest.fn(callback => callback(err)); // fail with the error
  const autoCloserHooks = new DefaultAutoCloserKeepAliveHooks<Closable>();

  keepAlive.hooks.dead.tapAsync('test', onDead);
  keepAlive.accept(autoCloserHooks);

  const ref = {} as AutoCloserReference<Closable>;
  autoCloserHooks.refOpened.call(ref);
  await expect(autoCloserHooks.refClosed.promise(ref)).rejects.toBe(err);
});
