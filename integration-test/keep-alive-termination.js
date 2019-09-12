const path = require('path');
const {execute} = require('@lib.cam/xslt-nailgun');

execute({
    xml: '<a/>',
    xsltPath: path.resolve(__dirname, 'wrap.xsl')
}).then(
    () => {
        console.log(`execute() completed; node process should exit immediately`)
    },
    (err) => {
        console.error('execute() failed', err);
        process.exit(1);
    });

