import path from 'path';
import {using} from '../src';
import {
  AddressType,
  getClasspath,
  parseClarkName,
  timeout,
} from '../src/_internals';

test('AddressType enum has string value', () => {
  expect(AddressType.local).toBe('local');
  expect(AddressType.network).toBe('network');
});

test('getClasspath()', () => {
  expect(getClasspath()).toEqual(
    `${path.resolve(__dirname, '../java/target/jars')}/*`
  );
});

test.each<[string, {ns: string | undefined; id: string}]>([
  ['foo', {ns: '', id: 'foo'}],
  ['{}foo', {ns: '', id: 'foo'}],
  ['{http://example}foo', {ns: 'http://example', id: 'foo'}],
  ['f‿͠', {ns: '', id: 'f‿͠'}],
  ['{a⁀}f‿͠', {ns: 'a⁀', id: 'f‿͠'}],
  [
    '{https://en.wiktionary.org/wiki/Ῥόδος}foo',
    {ns: 'https://en.wiktionary.org/wiki/Ῥόδος', id: 'foo'},
  ],
])('parseClarkName() accepts valid Clark qname %s', (value, expected) => {
  expect(parseClarkName(value)).toEqual(expected);
});

test.each([
  [
    '',
    "invalid Clark-encoded qname '': local identifier part is not a valid XML name: ''",
  ],
  [
    'foo=bar',
    "invalid Clark-encoded qname 'foo=bar': local identifier part is not a valid XML name: 'foo=bar'",
  ],
  ['{foo', "invalid Clark-encoded qname '{foo': no closing }"],
  [
    '{foo}}bar',
    "invalid Clark-encoded qname '{foo}}bar': local identifier part is not a valid XML name: '}bar'",
  ],
  [
    '{foo}foo bar',
    "invalid Clark-encoded qname '{foo}foo bar': local identifier part is not a valid XML name: 'foo bar'",
  ],
])('parseClarkName() rejects invalid Clark qname %s', (value, msg) => {
  expect(() => parseClarkName(value)).toThrow(msg);
});

describe('timeout()', () => {
  test('value is optional', async () => {
    let value: string | undefined = undefined;
    await expect(timeout(10).finished).resolves.toBeUndefined();
    await expect(timeout(10, value).finished).resolves.toBeUndefined();
    value = 'abc';
    await expect(timeout(10, value).finished).resolves.toBe('abc');
  });

  test('close() stops the timeout immediately', async () => {
    jest.useFakeTimers('modern');
    const onResolved = jest.fn();
    const onRejected = jest.fn();
    const t = timeout(1000 * 60, 'foo');

    t.finished.then(onResolved, onRejected);
    setTimeout(t.close, 500);
    jest.advanceTimersByTime(500);
    await t.finished;

    expect(onResolved.mock.calls.length).toBe(1);
    expect(onResolved.mock.calls[0][0]).toBe('foo');
    expect(onRejected.mock.calls.length).toBe(0);
  }, 2000);

  test('timeout() returns a resource manageable with using()', async () => {
    jest.useFakeTimers();
    const onResolved = jest.fn();
    const onRejected = jest.fn();

    await using(timeout(1000 * 60, 'foo'), t => {
      t.finished.then(onResolved, onRejected);
    });

    await expect(onResolved.mock.calls.length).toBe(1);
    await expect(onResolved.mock.calls[0][0]).toBe('foo');
    await expect(onRejected.mock.calls.length).toBe(0);
  });
});
