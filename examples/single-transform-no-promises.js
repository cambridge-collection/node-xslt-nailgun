let util = require('util');
let path = require('path');
let execute = util.callbackify(require('@lib.cam/xslt-nailgun').execute);

execute('example:foo.xml', '<foo>hi</foo>', path.resolve(__dirname, 'wrap.xsl'), (err, buffer) => {
    if(err) {
        console.error('Failed to execute transform: ' + e);
        process.exit(1);
    }
    console.log(buffer.toString());
});

// Output:
// <?xml version="1.0" encoding="UTF-8"?><result><foo>hi</foo></result>
