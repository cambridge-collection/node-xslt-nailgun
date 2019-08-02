import TraceError from 'trace-error';

export interface Closable {
    close(): Promise<void> | void;
}

export type ResourceUser<A, B> = (resource: Promise<A>) => Promise<B> | B;

export async function using<A extends Closable, B>(resource: PromiseLike<A> | A, user: ResourceUser<A, B>): Promise<B> {
    const pendingResource = Promise.resolve(resource);
    let result: Promise<B>;
    let userFailed = false;
    try {
        result = Promise.resolve(await user(pendingResource));
    }
    catch(e) {
        userFailed = true;
        result = Promise.reject(e);
    }
    finally {
        let realResource;
        try {
            realResource = await pendingResource;
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
            }
        }
    }
    return result;
}
