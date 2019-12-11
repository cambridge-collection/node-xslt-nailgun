import {Closable, using, usingPromise} from '../src';

class Thing implements Closable {
    public isClosed: boolean = false;

    public close(): void {
        this.isClosed = true;
    }
}

test('using() closes resource after user\'s promise resolves', async () => {
    const resource = new Thing();

    const result = await using(resource, async r => {
        expect(r).toBe(resource);
        expect(resource.isClosed).toBe(false);
        return 42;
    });

    expect(result).toBe(42);
    expect(resource.isClosed).toBe(true);
    expect.assertions(4);
});

test('using() resource can be a Promise', async () => {
    const resource = new Thing();

    const result = await using(Promise.resolve(resource), async r => {
        expect(r).toBe(resource);
        expect(resource.isClosed).toBe(false);
        return 42;
    });

    expect(result).toBe(42);
    expect(resource.isClosed).toBe(true);
    expect.assertions(4);
});

test('using() closes resource if user function does not return a promise', async () => {
    const resource = new Thing();
    await expect(using(resource, () => 42)).resolves.toBe(42);
    expect(resource.isClosed).toBe(true);
    expect.assertions(2);
});

test('using() closes resource if user function throws error', async () => {
    const resource = new Thing();

    const result = using(resource, async () => {
        expect(resource.isClosed).toBe(false);
        throw new Error('failed to use resource');
    });

    await expect(result).rejects.toThrow('failed to use resource');
    expect(resource.isClosed).toBe(true);
    expect.assertions(3);
});

test('using() rejects with error from resource promise if it rejects', async () => {
    const resource: Promise<Closable> = Promise.reject(new Error('failed to create resource'));

    await expect(using(resource, async r => {
        await r;
        throw new Error('resource unexpectedly resolved');
    })).rejects.toThrow('failed to create resource');
});

test('usingPromise() rejects with error from user function if it and resource promise both fail', async () => {
    const resource: Promise<Closable> = Promise.reject(new Error('failed to create resource'));

    await expect(usingPromise(resource, async r => {
        throw new Error('failed to use resource');
    })).rejects.toThrow('failed to use resource');
});

test('using() rejects with error from resource promise if rejects', async () => {
    const resource: Promise<Closable> = Promise.reject(new Error('failed to create resource'));

    await expect(using(resource, async r => {
        throw new Error('failed to use resource');
    })).rejects.toThrow('failed to create resource');
});

test('using() rejects with error if close() fails', async () => {
    const resource = Promise.resolve({
        close() {
            throw new Error('failed to close');
        },
    });

    await expect(using(resource, () => undefined)).rejects.toThrow('close() failed on resource');
});

test('using() rejects with error from user function if it and close() both fail', async () => {
    const resource = Promise.resolve({
        close() {
            throw new Error('failed to close');
        },
    });

    await expect(using(resource, () => {
        throw new Error('failed to use resource');
    })).rejects.toThrow('failed to use resource');
});
