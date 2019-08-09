import TraceError from 'trace-error';

export interface Closable {
    close(): Promise<void> | void;
}

export type ResourcePromiseUser<A, B> = (resource: Promise<A>) => Promise<B> | B;
export type ResourceUser<A, B> = (resource: A) => Promise<B> | B;

export async function using<A extends Closable, B>(resource: PromiseLike<A> | A, user: ResourceUser<A, B>): Promise<B> {
    return usingPromise(resource, async (resourcePromise) => {
        return user(await resourcePromise);
    });
}

export async function usingPromise<A extends Closable, B>(
    resource: PromiseLike<A> | A, user: ResourcePromiseUser<A, B>,
): Promise<B> {
    let result: Promise<B> = Promise.resolve(user(Promise.resolve(resource)));
    let userFailed = false;
    try {
        await result;
    }
    catch(e) {
        userFailed = true;
    }
    finally {
        let realResource;
        try {
            realResource = await resource;
        }
        catch(e) {
            // Prefer to fail with an error from the user function
            if(!userFailed)
                result = Promise.reject(new TraceError('The resource promise was rejected', e));
        }
        if(realResource !== undefined) {
            try {
                await realResource.close();
            }
            catch(e) {
                if(!userFailed)
                    result = Promise.reject(new TraceError('close() failed on resource', e));
                // Note that we ignore a failure in close() if the user also failed
            }
        }
    }
    return result;
}
