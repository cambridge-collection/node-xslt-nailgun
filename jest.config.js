module.exports = {
  globals: {
    'ts-jest': {
      tsConfig: 'tsconfig.json'
    }
  },
  moduleFileExtensions: [
    'ts',
    'js',
    'json'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  testMatch: [
    '<rootDir>/test/**/*.test.(ts|js)'
  ],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^./vendor/(.*)': '<rootDir>/lib/vendor/$1'
  },
  modulePathIgnorePatterns: ['<rootDir>/build/']
};
