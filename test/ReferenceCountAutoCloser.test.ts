import {ReferenceCountAutoCloser} from '../src/_internals';
import {using} from '../src/_resources';

test('resource is closed after initial user completes', async () => {
    const mockClose = jest.fn();
    const resource = {close: mockClose};

    const closer = new ReferenceCountAutoCloser(Promise.resolve(resource));
    expect(closer.isClosed()).toBe(false);
    expect(mockClose.mock.calls.length).toBe(0);

    const ref = closer.ref();
    expect(ref.resource).resolves.toBe(resource);

    expect(closer.referenceCount).toBe(1);
    expect(mockClose.mock.calls.length).toBe(0);
    await ref.close();

    expect(closer.isClosed()).toBe(true);
    expect(closer.referenceCount).toBe(0);
    expect(mockClose.mock.calls.length).toBe(1);

    expect.assertions(8);
});

test('resource is not closed when a ref closes if another ref is active', async () => {
    const mockClose = jest.fn();
    const resource = {close: mockClose};

    const closer = new ReferenceCountAutoCloser(Promise.resolve(resource));
    const ref1 = closer.ref();
    const ref2 = closer.ref();
    expect(closer.referenceCount).toBe(2);
    expect(closer.isClosed()).toBe(false);

    await ref1.close();
    expect(closer.referenceCount).toBe(1);
    expect(closer.isClosed()).toBe(false);
    expect(mockClose.mock.calls.length).toBe(0);

    await ref2.close();
    expect(closer.referenceCount).toBe(0);
    expect(closer.isClosed()).toBe(true);
    expect(mockClose.mock.calls.length).toBe(1);

    expect.assertions(8);
});

test('using() closes references', async () => {
    const mockClose = jest.fn();
    const resource = {close: mockClose};

    const closer = new ReferenceCountAutoCloser(Promise.resolve(resource));

    const use1 = using(closer.ref(), async ref => {
        await expect((await ref).resource).resolves.toBe(resource);
    });

    const use2 = using(closer.ref(), async ref => {
        await expect((await ref).resource).resolves.toBe(resource);
    });

    expect(closer.referenceCount).toBe(2);
    expect(mockClose.mock.calls.length).toBe(0);
    await Promise.all([use1, use2]);
    expect(closer.referenceCount).toBe(0);
    expect(mockClose.mock.calls.length).toBe(1);
});
