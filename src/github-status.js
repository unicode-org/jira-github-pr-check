// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const octokit = require("@octokit/rest")();

octokit.authenticate({
	type: "token",
	token: process.env.GITHUB_TOKEN
});

async function createStatus(pullRequest, pass, targetUrl, description) {
	await octokit.repos.createStatus({
		owner: process.env.GITHUB_OWNER,
		repo: process.env.GITHUB_REPO,
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
