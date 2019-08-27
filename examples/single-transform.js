let path = require('path');
let {execute} = require('@lib.cam/xslt-nailgun');

async function main() {
    let buffer = await execute('example:foo.xml', '<foo>hi</foo>', path.resolve(__dirname, 'wrap.xsl'));
    console.log(buffer.toString());
}
main().catch(e => {
    console.error('Failed to execute transform: ' + e);
    process.exit(1);
});

// Output:
// <?xml version="1.0" encoding="UTF-8"?><result><foo>hi</foo></result>
