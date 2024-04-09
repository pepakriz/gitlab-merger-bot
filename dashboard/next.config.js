// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
	env: {
		API_URL: process.env.API_URL,
		WS_URL: process.env.WS_URL,
	},
	output: 'export',
	experimental: {
		typedRoutes: true,
	},
	typescript: {
		// We can ignore it because we have another job in the pipeline for static analysis
		ignoreBuildErrors: true,
	},
};

module.exports = nextConfig;
