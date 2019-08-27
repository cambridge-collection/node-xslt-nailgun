let path = require('path');
let execute = require('@lib.cam/xslt-nailgun').execute;

execute('example:foo.xml', '<foo>hi</foo>', path.resolve(__dirname, 'wrap.xsl'))
    .then(buffer => console.log(buffer.toString()))
    .catch(e => {
        console.error('Failed to execute transform: ' + e);
        process.exit(1);
    });

// Output:
// <?xml version="1.0" encoding="UTF-8"?><result><foo>hi</foo></result>
