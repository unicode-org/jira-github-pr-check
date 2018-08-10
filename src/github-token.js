// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const jwt = require("jsonwebtoken");
const octokitRest = require("@octokit/rest");
const path = require("path");

const pemBuffer = process.env.GITHUB_APP_PEM_FILE
	? require("fs").readFileSync(path.join(__dirname, "..", process.env.GITHUB_APP_PEM_FILE))
	: Buffer.from(process.env.GITHUB_APP_PEM_BLOB, "base64");

let latestToken = null;
let latestTokenExpiration = 0;

async function getNewToken() {
	const nowTimestamp = parseInt(new Date().valueOf()/1000);
	if (nowTimestamp + 60 < latestTokenExpiration) {
		return latestToken;
	}
	const expiration = nowTimestamp + 300;
	const payload = {
		iat: nowTimestamp,
		exp: expiration,
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
	latestToken = result.data.token;
	latestTokenExpiration = expiration;
	console.log("Got new GitHub access token; expires at " + new Date(expiration*1000));
	return latestToken;
}

module.exports = {
	getNewToken
};
