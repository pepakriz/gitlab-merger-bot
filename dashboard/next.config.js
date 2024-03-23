module.exports = {
	env: {
		API_URL: process.env.API_URL,
		WS_URL: process.env.WS_URL,
	},
	output: 'export',
	exportPathMap: function () {
		return {
			'/': { page: '/' },
		};
	},
};
