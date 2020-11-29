module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^./vendor/(.*)': '<rootDir>/lib/vendor/$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/build/'],
};
