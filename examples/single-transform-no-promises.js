const util = require('util');
const path = require('path');
const execute = util.callbackify(require('@lib.cam/xslt-nailgun').execute);

execute(
  {xml: '<foo>hi</foo>', xsltPath: path.resolve(__dirname, 'wrap.xsl')},
  (err, buffer) => {
    if (err) {
      console.error('Failed to execute transform: ' + e);
      process.exit(1);
    }
    console.log(buffer.toString());
  }
);

// Output:
// <?xml version="1.0" encoding="UTF-8"?><result><foo>hi</foo></result>
