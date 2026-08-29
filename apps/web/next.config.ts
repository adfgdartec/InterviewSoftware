import type { NextConfig } from 'next';

/**
 * The workspace packages are consumed as TypeScript source rather than as built artifacts,
 * so Next has to transpile them, and its resolver has to understand that an import ending in
 * `.js` refers to a `.ts` file. That is the NodeNext convention the packages are written in;
 * without `extensionAlias` every cross-package import fails to resolve.
 */
const nextConfig: NextConfig = {
  transpilePackages: [
    '@loopcraft/core',
    '@loopcraft/db',
    '@loopcraft/providers',
    '@loopcraft/scoring',
    '@loopcraft/design',
    '@loopcraft/billing',
    '@loopcraft/sandbox',
  ],
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
