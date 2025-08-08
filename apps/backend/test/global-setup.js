// Global setup for E2E tests: reset Prisma database before running tests
const { execSync } = require('node:child_process');

module.exports = async () => {
  try {
    execSync('pnpm prisma migrate reset --force --skip-generate', {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env,
    });
  } catch (error) {
    console.error(
      'Global setup: prisma migrate reset failed',
      (error && error.message) || error,
    );
  }
};
