// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const bodyParser = require("body-parser");
const express = require("express");
const morgan = require("morgan");

const github = require("./src/github-status");
const jira = require("./src/jira-status");

const JIRA_COMMIT_PATTERN = /^([A-Z]+-\d+)\u0020\w/;

function parseMessage(message) {
	const match = JIRA_COMMIT_PATTERN.exec(message);
	if (!match) {
		return null;
	}
	return match[1];
}

async function getJiraInfo(pullRequest) {
	const issueKey = parseMessage(pullRequest.title);
	if (!issueKey) {
		return {
			issueKey: null,
			pass: false,
			description: "Pull request title must start with a Jira ticket ID"
		};
	}

	// Load additional data from Jira and GitHub
	const [jiraStatus, commits] = await Promise.all([
		jira.getStatus(issueKey),
		github.getCommits({
			owner: pullRequest.base.repo.owner.login,
			repo: pullRequest.base.repo.name,
			number: pullRequest.number
		})
	]);
	const numCommits = commits.length;

	// Check Jira ticket for validity
	if (jiraStatus !== "Accepted" &&
			jiraStatus !== "Reviewing" &&
			jiraStatus !== "Review Feedback") {
		return {
			issueKey,
			jiraStatus,
			numCommits,
			pass: false,
			description: jiraStatus === null ?
				"Jira ticket " + issueKey + " not found" :
				"Jira ticket " + issueKey + " is not accepted; it has status " + jiraStatus
		};
	}

	// Check for consistency with the commit messages
	for (const commitInfo of commits) {
		const commitIssueKey = parseMessage(commitInfo.commit.message);
		if (commitIssueKey === null) {
			return {
				issueKey,
				jiraStatus,
				numCommits,
				pass: false,
				description: "Commit message for " + commitInfo.sha.substr(0, 7) + " fails validation",
				badCommit: commitInfo
			};
		} else if (commitIssueKey !== issueKey) {
			return {
				issueKey,
				jiraStatus,
				numCommits,
				pass: false,
				description: "Commit " + commitInfo.sha.substr(0, 7) + " is for " + commitIssueKey + ", but the PR is for " + issueKey,
				badCommit: commitInfo
			};
		}
	}

	// Since we can't easilly check more than 100 commits, reject PRs with more than 100 commits
	if (commits.length === 100) {
		return {
			issueKey,
			jiraStatus,
			numCommits,
			pass: false,
			description: "PR has more than 100 commits; please rebase and squash"
		};
	}

	// All checks passed
	return {
		issueKey,
		jiraStatus,
		numCommits,
		pass: true,
		description: "Jira ticket " + issueKey + " has status " + jiraStatus
	};
}

async function touch(pullRequest, jiraInfo) {
	const owner = pullRequest.base.repo.owner.login;
	const repo = pullRequest.base.repo.name;
	const number = pullRequest.number;
	const url = process.env.URL_PREFIX + "/info/" + owner + "/" + repo + "/" + number;
	const multiCommitPass = jiraInfo.numCommits === 1;
	const multiCommitMessage = (jiraInfo.numCommits === 0) ? "No commits found on PR" : (jiraInfo.numCommits === 1) ? "This PR includes exactly 1 commit!" : "This PR has " + jiraInfo.numCommits + " commits; consider squashing to a single commit.";
	return Promise.all([
		github.createStatus("jira-ticket", pullRequest, jiraInfo.pass, url, jiraInfo.description),
		github.createStatus("single-commit", pullRequest, multiCommitPass, undefined, multiCommitMessage)
	]);
}

const app = express()
	.use(bodyParser.json())
	.use(bodyParser.urlencoded({ extended: false }))
	.use(morgan("tiny"))
	.get("/info/:owner/:repo/:number", async (req, res) => {
		try {
			const pullRequest = await github.getPullRequest(req.params);
			const jiraInfo = await getJiraInfo(pullRequest);
			return res.render("info.ejs", {
				params: req.params,
				pullRequest,
				jiraInfo,
				jiraUrl: jiraInfo.issueKey ? jira.getUrl(jiraInfo.issueKey) : undefined,
				badCommit: jiraInfo.badCommit
			});
		} catch (err) {
			if (err.code) {
				return res.sendStatus(err.code);
			} else {
				console.error(err);
				return res.sendStatus(500);
			}
		}
	})
	.post("/touch/:owner/:repo/:number", async (req, res) => {
		try {
			const pullRequest = await github.getPullRequest(req.params);
			const jiraInfo = await getJiraInfo(pullRequest);
			await touch(pullRequest, jiraInfo);
			return res.sendStatus(204);
		} catch (err) {
			if (err.code) {
				return res.sendStatus(err.code);
			} else {
				console.error(err);
				return res.sendStatus(500);
			}
		}
	})
	.post("/hook", async (req, res) => {
		try {
			const pullRequest = req.body.pull_request;
			const jiraInfo = await getJiraInfo(pullRequest);
			await touch(pullRequest, jiraInfo);
			return res.sendStatus(204);
		} catch (err) {
			if (err.code) {
				return res.sendStatus(err.code);
			} else {
				console.error(err);
				return res.sendStatus(500);
			}
		}
	});

module.exports = {
	app: (req, res) => {
		return app(req, res);
	},
	getJiraInfo,
	touch
};
