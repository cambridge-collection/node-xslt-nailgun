const path = require('path');
const {XSLTExecutor} = require('@lib.cam/xslt-nailgun');

// Try to leak a nailgun process by not closing an executor an then calling process.exit()
const executor = XSLTExecutor.getInstance({jvmKeepaliveTimeout: 1000 * 60});
executor
  .execute({
    xml: '<foo>hi</foo>',
    xsltPath: path.resolve(__dirname, 'wrap.xsl'),
  })
  .then(() => {
    console.log('execute() completed, exiting without cleaning up');
    process.exit(0); // eslint-disable-line no-process-exit
  })
  .catch(e => {
    console.error('Failed to execute transform: ' + e);
    throw e;
  });
