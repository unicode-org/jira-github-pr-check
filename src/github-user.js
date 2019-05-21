// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const got = require("got");
const oauthLoginUrl = require("@octokit/oauth-login-url");

function createGithubLoginUrl() {
	return oauthLoginUrl.oauthLoginUrl({
		clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
		scopes: ["public_repo"],
	});
}

async function getToken(params) {
	const response = await got.post("https://github.com/login/oauth/access_token", {
		body: {
			client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
			client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
			code: params.code,
			state: params.state
		},
		json: true
	});
	return response.body.access_token;
}

module.exports = {
	createGithubLoginUrl,
	getToken,
};
