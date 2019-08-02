import path from 'path';
import {AddressType, getClasspath} from '../src/_internals';

test('AddressType enum has string value', () => {
    expect(AddressType.local).toBe('local');
    expect(AddressType.network).toBe('network');
});

test('getClasspath()', () => {
    expect(getClasspath()).toEqual(`${path.resolve(__dirname, '../java/target/jars')}/*`);
});
