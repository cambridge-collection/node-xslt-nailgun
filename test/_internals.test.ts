import path from 'path';
import {AddressType, getClasspath, parseClarkName} from '../src/_internals';

test('AddressType enum has string value', () => {
    expect(AddressType.local).toBe('local');
    expect(AddressType.network).toBe('network');
});

test('getClasspath()', () => {
    expect(getClasspath()).toEqual(`${path.resolve(__dirname, '../java/target/jars')}/*`);
});

test.each<[string, {ns: string | undefined, id: string}]>([
    ['foo', {ns: '', id: 'foo'}],
    ['{}foo', {ns: '', id: 'foo'}],
    ['{http://example}foo', {ns: 'http://example', id: 'foo'}],
    ['f‿͠', {ns: '', id: 'f‿͠'}],
    ['{a⁀}f‿͠', {ns: 'a⁀', id: 'f‿͠'}],
    ['{https://en.wiktionary.org/wiki/Ῥόδος}foo',
        {ns: 'https://en.wiktionary.org/wiki/Ῥόδος', id: 'foo'}],
])('parseClarkName() accepts valid Clark qname %s', (value, expected) => {
    expect(parseClarkName(value)).toEqual(expected);
});

test.each([
    ['', 'invalid Clark-encoded qname \'\': local identifier part is not a valid XML name: \'\''],
    ['foo=bar', 'invalid Clark-encoded qname \'foo=bar\': local identifier part is not a valid XML name: \'foo=bar\''],
    ['{foo', 'invalid Clark-encoded qname \'{foo\': no closing }'],
    ['{foo}}bar', 'invalid Clark-encoded qname \'{foo}}bar\': local identifier part is not a valid XML name: \'}bar\''],
    ['{foo}foo bar',
        'invalid Clark-encoded qname \'{foo}foo bar\': local identifier part is not a valid XML name: \'foo bar\''],
])('parseClarkName() rejects invalid Clark qname %s', (value, msg) => {
    expect(() => parseClarkName(value)).toThrow(msg);
});
