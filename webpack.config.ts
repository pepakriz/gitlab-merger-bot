import path from 'path';

import webpack, { Configuration } from 'webpack';
import nodeExternals from 'webpack-node-externals';
import NodemonPlugin from 'nodemon-webpack-plugin';

const plugins = [new webpack.EnvironmentPlugin({ WEBPACK: true })];

if (process.env.NODE_ENV !== 'production') {
	plugins.push(new NodemonPlugin());
}

const config: Configuration = {
	mode: process.env.NODE_ENV !== 'production' ? 'development' : 'development',
	entry: './src/index.ts',
	target: 'node',
	externals: [nodeExternals()],
	devtool: process.env.NODE_ENV !== 'production' ? 'cheap-module-eval-source-map' : 'source-map',
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			},
			{
				test: /\.mjs$/,
				include: /node_modules/,
				type: 'javascript/auto',
			},
			{
				test: /\.graphql?$/,
				use: [
					{
						loader: 'webpack-graphql-loader',
						options: {
							// validate: true,
							// schema: "./path/to/schema.json",
							// removeUnusedFragments: true
							// etc. See "Loader Options" below
						},
					},
				],
			},
		],
	},
	resolve: {
		extensions: ['.tsx', '.ts', '.mjs', '.js'],
	},
	output: {
		libraryTarget: 'commonjs',
		filename: 'index.js',
		path: path.resolve(__dirname, 'lib'),
	},
	plugins,
};

module.exports = config;
