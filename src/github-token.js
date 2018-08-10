// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const jwt = require("jsonwebtoken");
const octokitRest = require("@octokit/rest");
const path = require("path");

const pemBuffer = require("fs").readFileSync(path.join(__dirname, "..", process.env.GITHUB_APP_PEM_FILE));

async function getNewToken() {
	const nowTimestamp = parseInt(new Date().valueOf()/1000);
	const payload = {
		iat: nowTimestamp,
		exp: nowTimestamp + 300,
		iss: process.env.GITHUB_APP_ID
	};
	const jwtToken = await new Promise((resolve, reject) => {
		jwt.sign(payload, pemBuffer, { algorithm: "RS256"}, (err, result) => {
			if (err) {
				reject(err);
			} else {
				resolve(result);
			}
		});
	});
	const octokitJwtClient = octokitRest();
	octokitJwtClient.authenticate({
		type: "app",
		token: jwtToken
	});
	const result = await octokitJwtClient.apps.createInstallationToken({
		installation_id: process.env.GITHUB_APP_INSTALLATION_ID
	});
	return result.data.token;
}

module.exports = {
	getNewToken
};
