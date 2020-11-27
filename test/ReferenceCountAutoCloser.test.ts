import {using} from '../src';
import {
  DefaultAutoCloser,
  ReferenceCountKeepAliveStrategy,
} from '../src/_internals';

test('resource is closed after initial user completes', async () => {
  expect.assertions(7);

  const mockClose = jest.fn();
  const resource = {close: mockClose};

  const closer = new DefaultAutoCloser(
    Promise.resolve(resource),
    new ReferenceCountKeepAliveStrategy()
  );
  expect(closer.isClosed()).toBe(false);
  expect(mockClose.mock.calls.length).toBe(0);

  const ref = closer.ref();
  expect(ref.resource).resolves.toBe(resource);

  expect(closer.isClosed()).toBe(false);
  expect(mockClose.mock.calls.length).toBe(0);
  await ref.close();

  expect(closer.isClosed()).toBe(true);
  expect(mockClose.mock.calls.length).toBe(1);
});

test('resource is not closed when a ref closes if another ref is active', async () => {
  expect.assertions(5);

  const mockClose = jest.fn();
  const resource = {close: mockClose};

  const closer = new DefaultAutoCloser(
    Promise.resolve(resource),
    new ReferenceCountKeepAliveStrategy()
  );
  const ref1 = closer.ref();
  const ref2 = closer.ref();
  expect(closer.isClosed()).toBe(false);

  await ref1.close();
  expect(closer.isClosed()).toBe(false);
  expect(mockClose.mock.calls.length).toBe(0);

  await ref2.close();
  expect(closer.isClosed()).toBe(true);
  expect(mockClose.mock.calls.length).toBe(1);
});

test('using() closes references', async () => {
  expect.assertions(6);

  const mockClose = jest.fn();
  const resource = {close: mockClose};

  const closer = new DefaultAutoCloser(
    Promise.resolve(resource),
    new ReferenceCountKeepAliveStrategy()
  );

  const use1 = using(closer.ref(), async ref => {
    await expect(ref.resource).resolves.toBe(resource);
  });

  const use2 = using(closer.ref(), async ref => {
    await expect(ref.resource).resolves.toBe(resource);
  });

  expect(closer.isClosed()).toBe(false);
  expect(mockClose.mock.calls.length).toBe(0);
  await Promise.all([use1, use2]);
  expect(closer.isClosed()).toBe(true);
  expect(mockClose.mock.calls.length).toBe(1);
});
