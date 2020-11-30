module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^./vendor/(.*)': '<rootDir>/lib/vendor/$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/build/'],
  slowTestThreshold: 10,
  testTimeout: 15 * 1000,
};
