var jvmpin = require('../lib/jvmpin');

function createTestConnection(options) {
    return jvmpin.createConnection(Object.assign({
        port: parseInt(process.env.NG_PORT) || undefined,
    }, options))
}

module.exports = createTestConnection;
