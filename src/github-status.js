// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const octokit = require("@octokit/rest")();

if (process.env.GITHUB_TOKEN) {
	octokit.authenticate({
		type: "token",
		token: process.env.GITHUB_TOKEN
	});
} else if (process.env.GITHUB_CLIENT_ID) {
	octokit.authenticate({
		type: "oauth",
		key: process.env.GITHUB_CLIENT_ID,
		secret: process.env.GITHUB_CLIENT_SECRET
	});
}

async function createStatus(pullRequest, pass, targetUrl, description) {
	const fullName = pullRequest.head.repo.full_name;  // "unicode-org/icu"
	const owner = fullName.split("/")[0];
	const repo = fullName.substr(owner.length + 1);
	await octokit.repos.createStatus({
		owner: owner,
		repo: repo,
		sha: pullRequest["head"]["sha"],
		state: pass ? "success" : "failure",
		target_url: targetUrl,
		description,
		context: "jira-ticket"
	});
}

module.exports = {
	createStatus
};
