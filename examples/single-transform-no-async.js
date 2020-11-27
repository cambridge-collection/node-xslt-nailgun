const path = require('path');
const execute = require('@lib.cam/xslt-nailgun').execute;

execute({xml: '<foo>hi</foo>', xsltPath: path.resolve(__dirname, 'wrap.xsl')})
  .then(buffer => console.log(buffer.toString()))
  .catch(e => {
    console.error('Failed to execute transform: ' + e);
    throw e;
  });

// Output:
// <?xml version="1.0" encoding="UTF-8"?><result><foo>hi</foo></result>
