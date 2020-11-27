const path = require('path');
const {execute} = require('@lib.cam/xslt-nailgun');

execute({
  xml: '<a/>',
  xsltPath: path.resolve(__dirname, 'wrap.xsl'),
}).then(
  () => {
    console.log('execute() completed; node process should exit immediately');
  },
  e => {
    console.error('execute() failed', e);
    throw e;
  }
);
