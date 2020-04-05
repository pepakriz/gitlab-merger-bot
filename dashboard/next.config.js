module.exports = {
	env: {
		API_URL: process.env.API_URL || 'http://127.0.0.4:4000/graphql',
		WS_URL: process.env.WS_URL,
	},
	exportPathMap: function () {
		return {
			'/': { page: '/' },
		};
	},
};
