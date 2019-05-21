// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const Octokit = require("@octokit/rest");

async function getAuthenticatedOctokitClient(token) {
	if (!token) {
		if (process.env.GITHUB_TOKEN) {
			token = process.env.GITHUB_TOKEN;
		} else if (process.env.GITHUB_APP_ID) {
			token = await require("./github-token").getNewToken();
		} else {
			throw new Error("Need either GITHUB_TOKEN or GITHUB_APP_ID");
		}
	}
	return new Octokit({
		auth: token
	});
}

async function createStatus(statusid, pullRequest, pass, targetUrl, description) {
	// TODO: Is it possible that pullRequest.base is different from the repository hosting the pull request?
	const owner = pullRequest.base.repo.owner.login;
	const repo = pullRequest.base.repo.name;
	const sha = pullRequest.head.sha;
	const state = pass ? "success" : "failure";
	console.log("Setting Status:", statusid, owner + "/" + repo, sha, "\"" + description + "\"");
	const data = {
		owner,
		repo,
		sha,
		state: state,
		target_url: targetUrl,
		// See issue #7: descriptions are limited to 140 characters
		description: description.substr(0, 130),
		context: statusid
	};
	const client = await getAuthenticatedOctokitClient();
	await client.repos.createStatus(data);
}

async function getPullRequest(params) {
	// params should have keys {owner, repo, pull_number}
	const client = await getAuthenticatedOctokitClient();
	const pullRequest = await client.pulls.get(params);
	return pullRequest.data;
}

async function getCommitDiff(params) {
	// params should have keys {owner, repo, base, head}
	const client = await getAuthenticatedOctokitClient();
	const reviews = await client.repos.compareCommits(params);
	return reviews.data;
}

async function postComment(params) {
	// params should have keys {owner, repo, pull_number, body}
	const client = await getAuthenticatedOctokitClient();
	// Note: pull request comments are handled via the issues API
	return client.issues.createComment(params);
}

async function getCommits(params) {
	// params should have keys {owner, repo, pull_number}
	const client = await getAuthenticatedOctokitClient();
	// Get max commits per page (100)
	const newParams = Object.assign({
		per_page: 100
	}, params);
	const commitsResult = await client.pulls.listCommits(newParams);
	return commitsResult.data;
}

async function writeSquashCommit(githubToken, { owner, repo, parentSha, headSha, message }) {
	const client = await getAuthenticatedOctokitClient(githubToken);
	const commitData1 = await client.git.getCommit({
		owner,
		repo,
		commit_sha: headSha
	});
	// Copy the author to the committer, and set the date to today
	const committer = Object.assign({}, commitData1.data.author);
	committer.date = new Date().toISOString();
	// Optionally set the name and email by env variables
	if (process.env.COMMITTER_NAME && process.env.COMMITTER_EMAIL) {
		committer.name = process.env.COMMITTER_NAME;
		committer.email = process.env.COMMITTER_EMAIL;
	}
	const commitData2 = await client.git.createCommit({
		owner,
		repo,
		message,
		tree: commitData1.data.tree.sha,
		parents: [parentSha],
		author: commitData1.data.author,
		committer
	});
	return commitData2.data;
}

async function writeBranch(githubToken, params) {
	// params should have keys {owner, repo, ref, sha, force}
	const client = await getAuthenticatedOctokitClient(githubToken);
	const refData = await client.git.updateRef(params);
	return refData.data;
}

module.exports = {
	createStatus,
	getPullRequest,
	getCommitDiff,
	postComment,
	getCommits,
	writeSquashCommit,
	writeBranch
};
