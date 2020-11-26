let path = require('path');
let {XSLTExecutor} = require('@lib.cam/xslt-nailgun');

// Run a nailgun process then keep it around by doing nothing for a while before exiting
let executor = XSLTExecutor.getInstance({jvmKeepaliveTimeout: 1000 * 60});
executor.execute({xml: '<foo>hi</foo>', xsltPath: path.resolve(__dirname, 'wrap.xsl')})
.then(() => {
    console.log(`execute() completed; waiting for 60 seconds before exiting...`);
    return new Promise((resolve) => { setTimeout(resolve, 1000 * 60)});
})
.catch(e => {
    console.error('Failed to execute transform: ' + e);
    process.exit(1);
});


